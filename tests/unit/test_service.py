"""Unit tests for the `flashforge.set_slot_filament` service.

The service is the write path behind the Material Station entities: it sets the
filament name and color a printer shows for a slot, the same `msConfig_cmd` the
desktop app sends. What is tested is everything around the library call: value
validation, target resolution through the entity/device registries, and what
happens when the printer refuses.

The service schema is Home Assistant's to apply, so these tests call the handler
with fully-formed service calls, including the Home Assistant reference carried
by ServiceCall. Registration is exercised through its one-argument callback.
"""
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# Mock Home Assistant modules before importing integration code
from tests.ha_mocks import mock_homeassistant

mock_homeassistant()

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.flashforge.const import DOMAIN
from custom_components.flashforge.service import (
    SERVICE_SET_SLOT_FILAMENT,
    SET_SLOT_FILAMENT_SCHEMA,
    async_register_services,
    async_set_slot_filament,
)

ENTRY_ID = "entry-1"
ENTRY_ID_2 = "entry-2"


def make_hass(entries=((ENTRY_ID, "Workshop C5"),), *, accepts=True):
    """Build a hass mock holding the given loaded FlashForge entries."""
    hass = Mock()
    hass.data = {DOMAIN: {}}
    clients = {}
    coordinators = {}
    for entry_id, name in entries:
        client = Mock()
        client.control = Mock()
        client.control.configure_slot = AsyncMock(return_value=accepts)
        coordinator = Mock()
        coordinator.async_request_refresh = AsyncMock()
        hass.data[DOMAIN][entry_id] = {
            "client": client,
            "coordinator": coordinator,
            "name": name,
        }
        clients[entry_id] = client
        coordinators[entry_id] = coordinator
    return hass, clients, coordinators


def make_call(hass, *, slot=2, material="PETG", color="#4CAAF8", **targets):
    data = {"slot": slot, "material": material, "color": color, **targets}
    call = Mock()
    call.data = data
    call.hass = hass
    return call


def patch_registries(entries=None, devices=None):
    """Patch the entity/device registries to resolve the given targets."""
    entity_registry = Mock()
    entity_registry.async_get = Mock(
        side_effect=lambda entity_id: (entries or {}).get(entity_id)
    )
    device_registry = Mock()
    device_registry.async_get = Mock(
        side_effect=lambda device_id: (devices or {}).get(device_id)
    )
    stack = ExitStack()
    stack.enter_context(
        patch(
            "custom_components.flashforge.service.er.async_get",
            return_value=entity_registry,
        )
    )
    stack.enter_context(
        patch(
            "custom_components.flashforge.service.dr.async_get",
            return_value=device_registry,
        )
    )
    return stack


@pytest.mark.unit
class TestSetSlotFilament:
    def test_service_schema_accepts_picker_and_script_colors(self):
        """Both UI RGB lists and script hex strings must reach the handler."""
        for color in ([76, 170, 248], "#4CAAF8"):
            data = SET_SLOT_FILAMENT_SCHEMA(
                {"entity_id": "image.slot", "slot": 2, "material": "PETG", "color": color}
            )
            assert data["color"] == color

    @pytest.mark.asyncio
    async def test_entity_target_reaches_the_printer(self):
        """An entity target resolves to its entry and the library is called."""
        hass, clients, coordinators = make_hass()
        entry = Mock(config_entry_id=ENTRY_ID)

        with patch_registries(entries={"image.c5_material_station_slot_1": entry}):
            await async_set_slot_filament(
                make_call(hass, entity_id=["image.c5_material_station_slot_1"])
            )

        clients[ENTRY_ID].control.configure_slot.assert_awaited_once_with(
            2, "PETG", "#4CAAF8"
        )
        coordinators[ENTRY_ID].async_request_refresh.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_color_picker_rgb_is_converted_to_hex(self):
        """HA's color picker returns three integers, not a hex string."""
        hass, clients, _ = make_hass()
        entry = Mock(config_entry_id=ENTRY_ID)
        with patch_registries(entries={"image.slot": entry}):
            await async_set_slot_filament(
                make_call(hass, entity_id="image.slot", color=[76, 170, 248])
            )
        clients[ENTRY_ID].control.configure_slot.assert_awaited_once_with(
            2, "PETG", "#4CAAF8"
        )

    @pytest.mark.asyncio
    async def test_device_target_reaches_every_printer_on_it(self):
        """A device target hits all its config entries."""
        hass, clients, coordinators = make_hass(
            entries=((ENTRY_ID, "A"), (ENTRY_ID_2, "B"))
        )
        device = Mock(config_entries=[ENTRY_ID, ENTRY_ID_2])

        with patch_registries(devices={"dev-1": device}):
            await async_set_slot_filament(make_call(hass, device_id=["dev-1"]))

        for entry_id in (ENTRY_ID, ENTRY_ID_2):
            clients[entry_id].control.configure_slot.assert_awaited_once()
            coordinators[entry_id].async_request_refresh.assert_awaited_once()

    @pytest.mark.parametrize(
        "overrides, message_part",
        [
            ({"slot": 0}, "Slot must be between"),
            ({"slot": 5}, "Slot must be between"),
            ({"material": "  "}, "Material must not be empty"),
            ({"color": "4CAAF8"}, "must be #RRGGBB"),
            ({"color": "#4CAAF"}, "must be #RRGGBB"),
            ({"color": [256, 0, 0]}, "three RGB values"),
            ({"color": [1, 2]}, "three RGB values"),
            ({"color": [True, 0, 0]}, "three RGB values"),
        ],
    )
    @pytest.mark.asyncio
    async def test_rejects_bad_values(self, overrides, message_part):
        """Values the schema cannot carry (or a bypassing caller) are refused.

        Validation runs before target resolution, so an unknown target cannot
        mask it.
        """
        hass, _, _ = make_hass()
        with pytest.raises(ServiceValidationError, match=message_part):
            await async_set_slot_filament(make_call(hass, **overrides))

    @pytest.mark.asyncio
    async def test_refuses_when_no_target_matches(self):
        """A target that resolves to no FlashForge printer is an error, not a no-op."""
        hass, _, _ = make_hass()

        with (
            patch_registries(),
            pytest.raises(ServiceValidationError, match="No FlashForge printer"),
        ):
            await async_set_slot_filament(make_call(hass, entity_id=["image.other_x"]))

    @pytest.mark.asyncio
    async def test_refuses_target_from_unloaded_entry(self):
        hass, _, _ = make_hass()
        entry = Mock(config_entry_id="other-entry")
        with (
            patch_registries(entries={"image.other": entry}),
            pytest.raises(ServiceValidationError, match="No FlashForge printer"),
        ):
            await async_set_slot_filament(make_call(hass, entity_id="image.other"))

    @pytest.mark.asyncio
    async def test_reports_when_the_printer_refuses(self):
        """`configure_slot` False (wrong model, printer refused) is a real error."""
        hass, _, _ = make_hass(accepts=False)
        entry = Mock(config_entry_id=ENTRY_ID)

        with (
            patch_registries(entries={"image.c5_material_station_slot_1": entry}),
            pytest.raises(HomeAssistantError, match="did not accept"),
        ):
            await async_set_slot_filament(
                make_call(hass, entity_id=["image.c5_material_station_slot_1"])
            )


@pytest.mark.unit
class TestServiceRegistration:
    def test_registers_once(self):
        """Global registration must not happen per entry."""
        hass = Mock()
        hass.data = {}

        async_register_services(hass)
        async_register_services(hass)

        hass.services.async_register.assert_called_once_with(
            DOMAIN,
            SERVICE_SET_SLOT_FILAMENT,
            async_set_slot_filament,
            schema=SET_SLOT_FILAMENT_SCHEMA,
        )

    @pytest.mark.asyncio
    async def test_registered_handler_accepts_home_assistant_service_call(self):
        """Home Assistant invokes a service handler with one ServiceCall argument."""
        hass, clients, coordinators = make_hass()
        entry = Mock(config_entry_id=ENTRY_ID)
        async_register_services(hass)
        handler = hass.services.async_register.call_args.args[2]

        with patch_registries(entries={"image.slot": entry}):
            await handler(make_call(hass, entity_id="image.slot"))

        clients[ENTRY_ID].control.configure_slot.assert_awaited_once_with(
            2, "PETG", "#4CAAF8"
        )
        coordinators[ENTRY_ID].async_request_refresh.assert_awaited_once()
