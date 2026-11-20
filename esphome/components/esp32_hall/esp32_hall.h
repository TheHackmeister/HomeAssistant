#pragma once
#include "esphome/core/component.h"
#include "esphome/components/sensor/sensor.h"
#include "esp_adc/adc_oneshot.h"

namespace esphome {
namespace esp32_hall {

class ESP32HallSensor : public sensor::Sensor, public PollingComponent {
 public:
  void setup() override;
  void update() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::DATA; }

 protected:
  adc_oneshot_unit_handle_t adc1_{nullptr};
  int raw_read_(int channel);
};

}  // namespace esp32_hall
}  // namespace esphome
