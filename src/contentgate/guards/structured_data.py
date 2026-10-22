"""JSON-LD structured data that parses and says what the page is.

Read with a real JSON parser, never grep. A block with a trailing comma is
ignored by every consumer, and a grep for "@type" would still count it.

Types are collected from each top-level item, from items in @graph, and from
the author, publisher and creator of those items, because that is where
Organization and Person usually live. @type may be a string or a list.

A required type is satisfied by its schema.org subtypes (see SUBTYPES): a
BlogPosting is an Article, a NewsMediaOrganization is an Organization.

A page that declares ProfilePage is not required to be an Article: Google's
ProfilePage documentation lists author pages among its intended uses.
"""

import json
import re

from ..markup import WS

DEFAULT_REQUIRE_TYPES = ("Article", "BreadcrumbList", "Organization")

# A required type is satisfied by itself or by any type listed under it here.
# Article: every subtype schema.org defines (Google's Article documentation
# names NewsArticle and BlogPosting). Organization: the direct subtypes and the
# common families below LocalBusiness, a curated subset of the schema.org tree
# rather than all of it. Names checked against the schema.org vocabulary,
# 2026-10-23. mcp/src/audit.ts carries the same table; tests compare the two.
SUBTYPES = {
    "Article": [
        "APIReference", "AdvertiserContentArticle", "AnalysisNewsArticle", "AskPublicNewsArticle",
        "BackgroundNewsArticle", "BlogPosting", "DiscussionForumPosting", "LiveBlogPosting",
        "MedicalScholarlyArticle", "NewsArticle", "OpinionNewsArticle", "Report",
        "ReportageNewsArticle", "ReviewNewsArticle", "SatiricalArticle", "ScholarlyArticle",
        "SocialMediaPosting", "TechArticle"
    ],
    "Organization": [
        "AccountingService", "Airline", "AnimalShelter", "ArchiveOrganization", "AutoPartsStore",
        "AutomotiveBusiness", "Bakery", "BankOrCreditUnion", "BarOrPub", "BedAndBreakfast",
        "BikeStore", "BookStore", "Brewery", "CafeOrCoffeeShop", "Campground", "ChildCare",
        "ClothingStore", "CollegeOrUniversity", "ComputerStore", "Consortium", "ConvenienceStore",
        "Cooperative", "Corporation", "DanceGroup", "Dentist", "DepartmentStore", "DiagnosticLab",
        "Distillery", "DryCleaningOrLaundry", "EducationalOrganization", "ElectronicsStore",
        "ElementarySchool", "EmergencyService", "EmploymentAgency", "EntertainmentBusiness",
        "FastFoodRestaurant", "FinancialService", "Florist", "FoodEstablishment", "FundingScheme",
        "FurnitureStore", "GardenStore", "GovernmentOffice", "GovernmentOrganization",
        "GroceryStore", "HardwareStore", "HealthAndBeautyBusiness", "HighSchool", "HobbyShop",
        "HomeAndConstructionBusiness", "HomeGoodsStore", "Hospital", "Hostel", "Hotel",
        "IceCreamShop", "InsuranceAgency", "InternetCafe", "JewelryStore", "LegalService",
        "Library", "LibrarySystem", "LiquorStore", "LocalBusiness", "LodgingBusiness",
        "MedicalBusiness", "MedicalClinic", "MedicalOrganization", "MensClothingStore",
        "MiddleSchool", "MobilePhoneStore", "Motel", "MovieRentalStore", "MusicGroup",
        "MusicStore", "NGO", "NewsMediaOrganization", "OfficeEquipmentStore", "OnlineBusiness",
        "OnlineStore", "OutletStore", "PawnShop", "PerformingGroup", "PetStore", "Pharmacy",
        "Physician", "PoliticalParty", "Preschool", "ProfessionalService", "Project",
        "RadioStation", "RealEstateAgent", "RecyclingCenter", "ResearchOrganization", "Resort",
        "Restaurant", "School", "SearchRescueOrganization", "SelfStorage", "ShoeStore",
        "ShoppingCenter", "SportingGoodsStore", "SportsActivityLocation", "SportsOrganization",
        "SportsTeam", "Store", "TelevisionStation", "TheaterGroup", "TireShop",
        "TouristInformationCenter", "ToyStore", "TravelAgency", "VacationRental",
        "VeterinaryCare", "WholesaleStore", "Winery", "WorkersUnion"
    ],
}


def satisfied(required, present):
    """`required` is present itself or through one of its listed subtypes."""
    return required in present or any(t in present for t in SUBTYPES.get(required, ()))

_BLOCK = re.compile(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", re.I | re.S | re.A)
_NESTED = ("author", "publisher", "creator")


def _reject_constant(name):
    # Python's json module accepts NaN and Infinity; JSON does not, and neither
    # does JSON.parse. A block containing them is broken for real consumers.
    raise ValueError("{} is not valid JSON".format(name))


def _add_types(out, value):
    for t in (value if isinstance(value, list) else [value]):
        if isinstance(t, str) and t:
            out.append(t)


def _node(out, item):
    _add_types(out, item.get("@type"))
    for key in _NESTED:
        v = item.get(key)
        for x in (v if isinstance(v, list) else [v]):
            if isinstance(x, dict):
                _add_types(out, x.get("@type"))


def _dates(value):
    """Every non-empty string dateModified, anywhere in the parsed block."""
    found, stack = [], [value]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            dm = v.get("dateModified")
            if isinstance(dm, str) and dm:
                found.append(dm)
            stack.extend(reversed(list(v.values())))
        elif isinstance(v, list):
            stack.extend(reversed(v))
    return found


def parse(html):
    """Return (types, broken, dates).

    types   every @type found, in document order, duplicates kept
    broken  one error message per block that did not parse
    dates   every dateModified value found
    """
    types, broken, dates = [], [], []
    for block in _BLOCK.findall(html):
        try:
            data = json.loads(block.strip(WS), parse_constant=_reject_constant)
        except Exception as exc:  # ValueError, or RecursionError on absurd nesting
            broken.append(str(exc)[:80])
            continue
        dates.extend(_dates(data))
        for item in (data if isinstance(data, list) else [data]):
            if not isinstance(item, dict):
                continue
            _node(types, item)
            graph = item.get("@graph")
            for g in (graph if isinstance(graph, list) else [graph]):
                if isinstance(g, dict):
                    _node(types, g)
    return types, broken, dates


def check(html, require_types=DEFAULT_REQUIRE_TYPES, require_date_modified=True):
    """Return (problems, details)."""
    types, broken, dates = parse(html)
    present = set(types)
    wanted = list(require_types)
    if "ProfilePage" in present:
        wanted = [t for t in wanted if t != "Article"]
    missing = [t for t in wanted if not satisfied(t, present)]

    problems = []
    if broken:
        problems.append("{} JSON-LD block(s) do not parse: {}".format(
            len(broken), "; ".join(broken)))
    if missing:
        problems.append("structured data lacks {} (found: {})".format(
            ", ".join(missing), ", ".join(sorted(present)) or "none"))
    if require_date_modified and not dates:
        problems.append("no dateModified in the structured data")
    return problems, {"types": sorted(present), "broken_blocks": len(broken),
                      "date_modified": dates}
