"""Portable static handshape packages; JSON only, never executable models."""
from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Any

SCHEMA = 'signex.handshape.v1'
MAX_BYTES = 20_000_000

@dataclass(frozen=True)
class SignPackage:
    name: str
    language: str
    description: str
    samples: list[list[float]]
    radius: float

    def to_dict(self) -> dict[str, object]:
        return {'schema': SCHEMA, 'name': self.name, 'language': self.language,
                'description': self.description, 'samples': self.samples, 'radius': self.radius}


def parse_package(raw: object) -> SignPackage:
    if not isinstance(raw, dict) or raw.get('schema') != SCHEMA:
        raise ValueError('Formato de paquete incompatible.')
    name, description = raw.get('name'), raw.get('description', '')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60 or any(ord(c) < 32 for c in name):
        raise ValueError('Nombre inválido (1–60 caracteres).')
    if not isinstance(description, str) or len(description) > 500:
        raise ValueError('Descripción inválida (máximo 500 caracteres).')
    language = raw.get('language')
    if language not in ('LESCO', 'ASL', 'CUSTOM'):
        raise ValueError('Lengua no admitida.')
    samples = raw.get('samples')
    if not isinstance(samples, list) or len(samples) < 20:
        raise ValueError('Se necesitan al menos 20 muestras.')
    for row in samples:
        if not isinstance(row, list) or len(row) != 63:
            raise ValueError('Cada muestra requiere 63 coordenadas.')
        if any(type(x) not in (int, float) or not math.isfinite(x) or abs(x) > 10 for x in row):
            raise ValueError('Coordenadas inválidas.')
    radius = raw.get('radius')
    if type(radius) not in (int, float) or not math.isfinite(radius) or not .03 <= radius <= .15:
        raise ValueError('Umbral de distancia inválido.')
    return SignPackage(name.strip(), language, description, samples, float(radius))


def rms(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x-y)**2 for x,y in zip(a,b, strict=True))/63)


def predict(packages: list[SignPackage], vector: list[float], language: str) -> str | None:
    if len(vector) != 63 or not all(math.isfinite(x) for x in vector):
        return None
    scores = sorted((min(rms(vector, row) for row in p.samples)/p.radius, i)
                    for i,p in enumerate(packages) if p.language == language)
    if not scores or scores[0][0] > 1:
        return None
    if len(scores) > 1 and scores[1][0] - scores[0][0] < .2:
        return None
    return packages[scores[0][1]].name
