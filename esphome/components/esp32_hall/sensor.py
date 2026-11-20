import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import sensor
from esphome.const import STATE_CLASS_MEASUREMENT

DEPENDENCIES = ["esp32"]

esp32_hall_ns = cg.esphome_ns.namespace("esp32_hall")
ESP32HallSensor = esp32_hall_ns.class_(
    "ESP32HallSensor", sensor.Sensor, cg.PollingComponent
)

CONFIG_SCHEMA = sensor.sensor_schema(
    ESP32HallSensor,
    icon="mdi:magnet",
    accuracy_decimals=0,
    state_class=STATE_CLASS_MEASUREMENT,
).extend(cv.polling_component_schema("60s"))


async def to_code(config):
    var = await sensor.new_sensor(config)
    await cg.register_component(var, config)
