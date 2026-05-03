"""
TODO: REMOVE THIS! It is in use though :/

Update a single area manifest sensor.
Called by automation with area_id, entity_ids, and device_ids as parameters.
"""

area_id = data.get("area_id")
area_name = data.get("area_name", area_id)
entity_ids = data.get("entity_ids", [])
device_ids = data.get("device_ids", [])

if not area_id:
    logger.error("area_id is required")
else:
    # Create sensor entity_id
    safe_area_id = str(area_id).replace(" ", "_").replace("-", "_").lower()
    sensor_id = "sensor.{}_area_manifest".format(safe_area_id)

    entity_count = len(entity_ids)
    device_count = len(device_ids)

    attributes = {
        "friendly_name": "{} Area Manifest".format(area_name),
        "icon": "mdi:format-list-bulleted-square",
        "area_id": area_id,
        "area_name": area_name,
        "entity_ids": entity_ids,
        "device_ids": device_ids,
        "device_count": device_count,
        "entity_count": entity_count
    }

    # Set state to entity count
    hass.states.set(sensor_id, str(entity_count), attributes)
    logger.info("Updated {}: {} entities, {} devices".format(sensor_id, entity_count, device_count))