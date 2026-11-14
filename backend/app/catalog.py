from pydantic import BaseModel, Field


class CatalogSite(BaseModel):
    id: str
    name: str
    region: str
    latitude_deg: float
    longitude_deg: float
    estimated_height_km: float = 0.0
    description: str
    scientific_interest: str
    artemis_candidate: bool = True
    x_map_hint: float | None = None
    y_map_hint: float | None = None


# Official NASA Artemis III candidate landing regions and key lunar south pole locations
LUNAR_SOUTH_POLE_SITES: list[CatalogSite] = [
    CatalogSite(
        id="mouton",
        name="Mons Mouton",
        region="Región Artemis III",
        latitude_deg=-85.4,
        longitude_deg=-29.2,
        estimated_height_km=6.0,
        description="Meseta elevada, una de las estructuras de mayor altitud próximas al polo sur lunar.",
        scientific_interest="Extensas ventanas de luz solar continua y visibilidad de la Tierra; terreno plano favorable para aterrizaje seguro.",
        artemis_candidate=True,
        x_map_hint=40,
        y_map_hint=29,
    ),
    CatalogSite(
        id="malapert",
        name="Malapert Massif",
        region="Región Artemis III",
        latitude_deg=-86.0,
        longitude_deg=3.8,
        estimated_height_km=5.0,
        description="Macizo prominente con línea de visión directa y constante a la Tierra y relieve circundante complejo.",
        scientific_interest="Excelente cobertura de telecomunicaciones con estaciones terrestres (DSN) y alta persistencia de iluminación solar.",
        artemis_candidate=True,
        x_map_hint=66,
        y_map_hint=42,
    ),
    CatalogSite(
        id="haworth",
        name="Haworth Crater Rim",
        region="Región Artemis III",
        latitude_deg=-87.6,
        longitude_deg=-4.1,
        estimated_height_km=2.5,
        description="Borde de cráter adyacente a regiones de sombra permanente (PSR).",
        scientific_interest="Acceso prioritario a trampas frías de volátiles e hipotéticos depósitos de hielo de agua en el suelo del cráter.",
        artemis_candidate=True,
        x_map_hint=50,
        y_map_hint=64,
    ),
    CatalogSite(
        id="gerlache",
        name="de Gerlache Rim 2",
        region="Región Artemis III",
        latitude_deg=-88.3,
        longitude_deg=-59.5,
        estimated_height_km=3.2,
        description="Borde de cráter muy próximo al polo sur geográfico.",
        scientific_interest="Iluminación solar prolongada en verano lunar del sur y cercanía a depósitos volátiles en cráteres adyacentes.",
        artemis_candidate=True,
        x_map_hint=28,
        y_map_hint=66,
    ),
    CatalogSite(
        id="shackleton",
        name="Shackleton Crater Rim",
        region="Región Polar Sur",
        latitude_deg=-89.9,
        longitude_deg=0.0,
        estimated_height_km=4.2,
        description="Cráter de impacto cuyo borde coincide prácticamente con el polo sur lunar (89.9°S).",
        scientific_interest="Picos de luz cuasi-permanente (>80% del año lunar) y un interior sumido en oscuridad perpetua con hielo confirmado.",
        artemis_candidate=True,
        x_map_hint=50,
        y_map_hint=50,
    ),
    CatalogSite(
        id="nobile-1",
        name="Nobile Rim 1",
        region="Región Artemis III",
        latitude_deg=-85.2,
        longitude_deg=53.5,
        estimated_height_km=3.8,
        description="Borde oriental del cráter Nobile, seleccionado como área objetivo de prospección de volátiles (misión VIPER).",
        scientific_interest="Pendientes moderadas transitables, mosaico de microclimas térmicos e interfaz luz/sombra permanente.",
        artemis_candidate=True,
        x_map_hint=72,
        y_map_hint=35,
    ),
    CatalogSite(
        id="nobile-2",
        name="Nobile Rim 2",
        region="Región Artemis III",
        latitude_deg=-85.5,
        longitude_deg=54.8,
        estimated_height_km=3.6,
        description="Cresta secundaria adyacente al cráter Nobile.",
        scientific_interest="Ruta alternativa de aproximación con horizonte despejado hacia la Tierra para comunicación directa.",
        artemis_candidate=True,
        x_map_hint=74,
        y_map_hint=38,
    ),
    CatalogSite(
        id="faustini",
        name="Faustini Rim A",
        region="Región Artemis III",
        latitude_deg=-87.1,
        longitude_deg=84.3,
        estimated_height_km=2.8,
        description="Cresta elevada entre los cráteres Faustini y Shoemaker.",
        scientific_interest="Geología de impacto profunda y proximidad inmediata a trampas frías profundas en Shoemaker.",
        artemis_candidate=True,
        x_map_hint=85,
        y_map_hint=55,
    ),
    CatalogSite(
        id="amundsen",
        name="Amundsen Rim",
        region="Región Artemis III",
        latitude_deg=-84.5,
        longitude_deg=82.8,
        estimated_height_km=2.1,
        description="Borde norte del gran cráter de impacto Amundsen.",
        scientific_interest="Estratigrafía lunar expuesta del manto y corteza inferior; buen soporte de comunicación por elevación.",
        artemis_candidate=True,
        x_map_hint=88,
        y_map_hint=25,
    ),
    CatalogSite(
        id="connecting-ridge",
        name="Connecting Ridge",
        region="Región Artemis III",
        latitude_deg=-89.4,
        longitude_deg=-137.5,
        estimated_height_km=3.9,
        description="Cresta estrecha que conecta el cráter Shackleton con de Gerlache.",
        scientific_interest="Corredor natural de movilidad para rovers y alta exposición solar integrada anual.",
        artemis_candidate=True,
        x_map_hint=35,
        y_map_hint=75,
    ),
    CatalogSite(
        id="leibnitz-beta",
        name="Leibnitz Beta Plateau",
        region="Región Artemis III",
        latitude_deg=-85.8,
        longitude_deg=31.5,
        estimated_height_km=4.8,
        description="Meseta de gran altitud en el borde del macizo Leibnitz.",
        scientific_interest="Vistas panorámicas despejadas de la Tierra y períodos reducidos de oscuridad total.",
        artemis_candidate=True,
        x_map_hint=60,
        y_map_hint=35,
    ),
]


def list_sites(artemis_only: bool = False, query: str | None = None) -> list[CatalogSite]:
    sites = LUNAR_SOUTH_POLE_SITES
    if artemis_only:
        sites = [s for s in sites if s.artemis_candidate]
    if query:
        q = query.strip().lower()
        sites = [s for s in sites if q in s.name.lower() or q in s.id.lower() or q in s.region.lower()]
    return sites


def find_site(site_id: str) -> CatalogSite | None:
    target = site_id.strip().lower()
    for s in LUNAR_SOUTH_POLE_SITES:
        if s.id.lower() == target:
            return s
    return None
