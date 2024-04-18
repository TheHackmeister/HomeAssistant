"""Compensation constants."""
DOMAIN = "compensation"

SENSOR = "compensation"

CONF_COMPENSATION = "compensation"
CONF_DATAPOINTS = "data_points"
CONF_DEGREE = "degree"
CONF_MQTT_TOPIC = "mqtt_topic"
CONF_MQTT_PREFIX = "mqtt_prefix"
CONF_PRECISION = "precision"
CONF_POLYNOMIAL = "polynomial"
CONF_TRACKED_ENTITY_ID = "tracked_entity_id"

DATA_COMPENSATION = "compensation_data"

DEFAULT_CALIBRATED_POSTFIX = "_calibrated"
DEFAULT_DEGREE = 1
DEFAULT_NAME = "Compensation"
DEFAULT_PRECISION = 2

FLOW_KEEP_DATA_POINTS = "keep_data_points"

MATCH_DATAPOINT = r"([-+]?[0-9]+\.?[0-9]*){1} -> ([-+]?[0-9]+\.?[0-9]*){1}"
