import json

@service
def hello_world(action=None, id=None):
    """hello_world example using pyscript."""
    log.warning(f"hello world: got action {action} id {id}")

    #if action == "turn_on" and id is not None:
    #    light.turn_on(entity_id=id, brightness=255)
    #elif action == "fire" and id is not None:
    #    event.fire(id, param1=12, pararm2=80)

@service
def add_calibration_entity(entity=None):
    raw_entities = json.loads( var.calibration_entities )
    if raw_entities.get('entities'):
        entities = raw_entities['entities']
    else:
        entities = []

    if entity in entities:
        # TODO: Remove entity if already present.
        pass
    else:
        entities = entities + [entity]

    raw_entities['entities'] = entities
    var.calibration_entities = json.dumps(raw_entities)
    log.warning(f"{ raw_entities }")

state.persist('pyscript.calibration_readings')

@service
def add_calibration_reading(entity=None):
    """hello_world example using pyscript."""
    log.warning(f"add_calibration_reading: {entity}")

    # Load data from sensor attributes. 
    try:
        readings = json.loads( input_number.calibration_readings.json  )
    except AttributeError as exc:
        log.warning(f"No json attr.")
        readings = json.loads( "{}" )
    # TODO: Throw exception (or whatever pyscripts use?) if var.calibration_entities['readings']
    raw_entities = json.loads( var.calibration_entities )

    # Read each sensor and add to readings.
    current_readings = {}
    for entity in raw_entities.get('entities'):
        if not readings.get(entity + "_raw"):
            log.warning(f"Created key for {entity}")
            readings[entity + "_raw"] = []
            readings[entity + "_calibrated"] = []
        readings[entity + "_raw"].append(float(state.get(entity))) 
        readings[entity + "_calibrated"].append(float(input_number.calibration_input)) 
    log.warning(f"readings: {readings}")

    # Save data to sensor attribute. 
    input_number.calibration_readings.json = json.dumps(readings)

@service
def calibration_calc():
    """ ok  """
    log.warning(f"calibration_calc: got action id {id}")

    # Load data from sensor attributes. 
    try:
        readings = json.loads( input_number.calibration_readings.json  )
    except AttributeError as exc:
        log.warning(f"No json attr.")
        readings = json.loads( "{}" )
    # TODO: Throw exception (or whatever pyscripts use?) if var.calibration_entities['readings']
    raw_entities = json.loads( var.calibration_entities )

    #for entity, calibrated_readings in readings:
    for entity in raw_entities.get('entities'):
        X = readings[entity + "_raw"] # raw
        Y = readings[entity + "_calibrated"] # measurement
        log.warning(f"{ entity }| X: { X }, Y: { Y }")

        # START HERE: Need to import linear_model junk and get this to work. 

        #model = linear_model.LinearRegression().fit(X.values.reshape(-1, 1), Y.values.reshape(-1, 1))
    #            expression = re.compile(r'(?P<type>.+)_(?P<device>\d+)_(?P<sensor>.*)'.format(measurement.lower()))
    #            s = expression.search( sensor )
    #            if s:
    #                topic = f"seedship/{ s.group('type') }_{ s.group('device') }/{ s.group('sensor').replace('_raw', '_calibration') }"
    #                print(f"Linear calibration for { topic }: Slope({ model.coef_[0] }) Intercept({ model.intercept_[0]})")
    #                ViewSensor.send_mqtt(topic, { "slope": model.coef_[0][0], "bias": model.intercept_[0] }, retain=True )




    #try:
    #    calibration_values = json.loads( input_number.calibration_readings.json  )
    #except AttributeError as exc:
    #    log.warning(f"No json attr.")
    #    calibration_values = json.loads( "{}" )
    
    #raw_entities = json.loads( var.calibration_entities )

    #try:
    #    readings = json.loads( input_number.calibration_readings.json  )
    #except AttributeError as exc:
    #    log.warning(f"No json attr.")
    #    readings = json.loads( "{}" )

    for entity in raw_entities.get('entities'):
        #log.warning(f"Entity: {entity}")
        readings[entity] = float(state.get(entity))

    input_number.calibration_readings.json = "{}"



    #for sensor in raw_sensors.split(","):
    #            # TODO: Move this to flux so that I can maybe use bind_params. It works for queries, but not sub queries. 
    #            results = db.query(f"SELECT first(\"value\") AS \"value\", first(\"calibrated_value\") AS \"calibrated_value\" \
    #                FROM (SELECT \"value\" FROM \"raw\" WHERE (entity_id =~ /({ sensor })/) AND time >= { time_range_start }ms and time <= { time_range_end }ms), \
    #                (SELECT \"value\" AS \"calibrated_value\" FROM \"{ measurement }\" WHERE entity_id =~ /({ calibration_entity })/ AND time >= { time_range_start }ms and time <= { time_range_end }ms) \
    #                GROUP BY time(10s)")

    #            # Clean up results
    #            results = pandas.concat(results, keys=[measurement, "raw"], axis=1)
    #            results = results.dropna(axis=0)


