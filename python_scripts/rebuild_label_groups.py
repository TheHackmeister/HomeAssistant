"""Rebuild label_group.* entities from the label print groups JSON store.

Source of truth is /config/www/labels/print_groups.json (written by the
label-printer-card via shell_command.save_label_groups and lifted into
sensor.label_print_groups attributes by a command_line sensor). Entities are
ephemeral, so this script re-materializes them on HA start and whenever the
groups sensor changes. Each entity's attributes carry the full group record:
name, slug, search, template, fields, batch, saved_at.
"""

sensor = hass.states.get("sensor.label_print_groups")
groups = sensor.attributes.get("groups", []) if sensor else []

for group in groups:
    name = group.get("name", "")
    # No imports in python_script — hand-rolled slug: lowercase, non-alnum to _
    slug = "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")
    if not slug:
        continue
    hass.states.set(f"label_group.{slug}", name, {**group, "slug": slug})
