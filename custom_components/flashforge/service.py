"""Services for the FlashForge integration.

One service so far: `flashforge.set_slot_filament`, the write path behind the
Material Station entities. It sets the material name and color a printer shows
for a station slot - the same command the desktop app sends - which the printer
displays and validates prints against. On the Creator 5 series the four slots
are the four tool heads.

The library owns the wire format and the per-model differences (`Control.
configure_slot`, `msConfig_cmd`): the AD5X takes freeform `RRGGBB`, the Creator 5
snaps the color to its own 24-entry palette. This module only validates what a
client sends and reports what the printer answered.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

SERVICE_SET_SLOT_FILAMENT = "set_slot_filament"

_REGISTERED_KEY = f"{DOMAIN}_services_registered"

_MAX_SLOT = 4
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

# The schema is HA's to apply; the handler re-checks the values anyway so a
# caller that bypasses it (a script with a bad template, a test) fails the
# same way. Mirrors button.py: validate where the work happens.
SET_SLOT_FILAMENT_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): vol.Any(str, [str]),
        vol.Optional("device_id"): vol.Any(str, [str]),
        vol.Required("slot"): int,
        vol.Required("material"): str,
        # The HA color_rgb picker returns [red, green, blue]. Scripts may also
        # supply the documented #RRGGBB string directly.
        vol.Required("color"): vol.Any(str, list),
    },
    extra=vol.REMOVE_EXTRA,
)


def async_register_services(hass: HomeAssistant) -> None:
    """Register the integration's services, once per Home Assistant run."""
    if hass.data.get(_REGISTERED_KEY):
        return
    hass.data[_REGISTERED_KEY] = True
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_SLOT_FILAMENT,
        async_set_slot_filament,
        schema=SET_SLOT_FILAMENT_SCHEMA,
    )


def _as_list(value: str | list[str] | None) -> list[str]:
    """Accept both a single target and a list of targets."""
    return [value] if isinstance(value, str) else value or []


def _normalize_color(value: str | list[int]) -> str:
    """Convert HA's RGB picker result or a hex string to uppercase hex."""
    if isinstance(value, list):
        if len(value) != 3 or any(
            type(channel) is not int or not 0 <= channel <= 255
            for channel in value
        ):
            raise ServiceValidationError("Color must contain three RGB values from 0 to 255.")
        return "#" + "".join(f"{channel:02X}" for channel in value)
    if not isinstance(value, str) or not _HEX_COLOR.fullmatch(value.strip()):
        raise ServiceValidationError("Color must be #RRGGBB or three RGB values.")
    return value.strip().upper()


def _resolve_entry_ids(hass: HomeAssistant, service_data: dict[str, Any]) -> set[str]:
    """Map the service target (entities or devices) to config entry ids.

    An entity resolves through the entity registry; a device through the device
    registry and every config entry it belongs to. Unknown ids are skipped -
    they may belong to a printer that was removed while the call was composed.
    """
    entry_ids: set[str] = set()

    entity_registry = er.async_get(hass)
    for entity_id in _as_list(service_data.get("entity_id")):
        entry = entity_registry.async_get(entity_id)
        if entry and entry.config_entry_id:
            entry_ids.add(entry.config_entry_id)

    device_registry = dr.async_get(hass)
    for device_id in _as_list(service_data.get("device_id")):
        device = device_registry.async_get(device_id)
        if not device:
            continue
        entry_ids.update(device.config_entries or [])

    return entry_ids


async def async_set_slot_filament(call: Any) -> None:
    """Set a Material Station slot's filament name and color.

    Metadata only: the printer displays it and validates prints against it, it
    does not move or load filament. Available on the AD5X and the Creator 5
    series; other models refuse the command.
    """
    hass: HomeAssistant = call.hass
    slot: int = call.data["slot"]
    material: str = str(call.data["material"]).strip()
    color = _normalize_color(call.data["color"])

    if not 1 <= slot <= _MAX_SLOT:
        raise ServiceValidationError(
            f"Slot must be between 1 and {_MAX_SLOT}, not {slot}."
        )
    if not material:
        raise ServiceValidationError("Material must not be empty.")
    entry_ids = _resolve_entry_ids(hass, call.data)
    loaded = hass.data.get(DOMAIN, {})
    entry_ids = entry_ids.intersection(loaded)
    if not entry_ids:
        raise ServiceValidationError(
            "No FlashForge printer found for this target. Pick one of its "
            "entities or its device."
        )

    for entry_id in entry_ids:
        data = loaded[entry_id]

        client = data["client"]
        name = data["name"]

        accepted = await client.control.configure_slot(slot, material, color)
        if not accepted:
            raise HomeAssistantError(
                f"{name} did not accept setting slot {slot} to "
                f"{material} / {color}. The printer may not have a Material "
                "Station (AD5X and Creator 5 series only)."
            )

        _LOGGER.debug(
            "Set slot %d to %s / %s on %s", slot, material, color, name
        )
        await data["coordinator"].async_request_refresh()
