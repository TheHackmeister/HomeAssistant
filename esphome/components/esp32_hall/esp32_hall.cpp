#include "esp32_hall.h"
#include "esphome/core/log.h"
#include "soc/soc.h"
#include "soc/sens_reg.h"
#include "soc/rtc_io_reg.h"

namespace esphome {
namespace esp32_hall {

static const char *const TAG = "esp32_hall";

void ESP32HallSensor::setup() {
#if !CONFIG_IDF_TARGET_ESP32
  ESP_LOGE(TAG, "Internal hall sensor exists only on the original ESP32");
  this->mark_failed();
  return;
#else
  adc_oneshot_unit_init_cfg_t unit_cfg = {};
  unit_cfg.unit_id = ADC_UNIT_1;
  if (adc_oneshot_new_unit(&unit_cfg, &this->adc1_) != ESP_OK) {
    ESP_LOGE(TAG, "ADC1 unit already in use (another adc sensor on ADC1?)");
    this->mark_failed();
    return;
  }
  adc_oneshot_chan_cfg_t ch_cfg = {};
  ch_cfg.atten = ADC_ATTEN_DB_0;  // original driver used 0 dB
  ch_cfg.bitwidth = ADC_BITWIDTH_12;
  adc_oneshot_config_channel(this->adc1_, ADC_CHANNEL_0, &ch_cfg);  // GPIO36 / SENSOR_VP
  adc_oneshot_config_channel(this->adc1_, ADC_CHANNEL_3, &ch_cfg);  // GPIO39 / SENSOR_VN
#endif
}

// Classic ESP32 RTC-controller one-shot conversion on ADC1 (bypasses the driver's
// per-read setup, which can switch the hall block off).
int ESP32HallSensor::raw_read_(int channel) {
  SET_PERI_REG_BITS(SENS_SAR_MEAS_START1_REG, SENS_SAR1_EN_PAD, (1 << channel), SENS_SAR1_EN_PAD_S);
  CLEAR_PERI_REG_MASK(SENS_SAR_MEAS_START1_REG, SENS_MEAS1_START_SAR);
  SET_PERI_REG_MASK(SENS_SAR_MEAS_START1_REG, SENS_MEAS1_START_SAR);
  while (GET_PERI_REG_MASK(SENS_SAR_MEAS_START1_REG, SENS_MEAS1_DONE_SAR) == 0) {
  }
  return GET_PERI_REG_BITS2(SENS_SAR_MEAS_START1_REG, SENS_MEAS1_DATA_SAR, SENS_MEAS1_DATA_SAR_S);
}

void ESP32HallSensor::update() {
#if CONFIG_IDF_TARGET_ESP32
  int dummy;
  // Let the IDF driver apply width/attenuation/RTC-controller selection first.
  adc_oneshot_read(this->adc1_, ADC_CHANNEL_0, &dummy);
  adc_oneshot_read(this->adc1_, ADC_CHANNEL_3, &dummy);

  // Software control of SAR power, pad enable and start (RTC controller).
  SET_PERI_REG_BITS(SENS_SAR_MEAS_WAIT2_REG, SENS_FORCE_XPD_SAR, 3, SENS_FORCE_XPD_SAR_S);
  SET_PERI_REG_MASK(SENS_SAR_MEAS_START1_REG, SENS_MEAS1_START_FORCE_M | SENS_SAR1_EN_PAD_FORCE_M);

  // Espressif's original hall_sensor_get_value() sequence.
  SET_PERI_REG_MASK(SENS_SAR_TOUCH_CTRL1_REG, SENS_XPD_HALL_FORCE_M);
  SET_PERI_REG_MASK(RTC_IO_HALL_SENS_REG, RTC_IO_XPD_HALL);
  SET_PERI_REG_MASK(SENS_SAR_TOUCH_CTRL1_REG, SENS_HALL_PHASE_FORCE_M);
  CLEAR_PERI_REG_MASK(RTC_IO_HALL_SENS_REG, RTC_IO_HALL_PHASE);
  int vp0 = this->raw_read_(0);
  int vn0 = this->raw_read_(3);
  SET_PERI_REG_MASK(RTC_IO_HALL_SENS_REG, RTC_IO_HALL_PHASE);
  int vp1 = this->raw_read_(0);
  int vn1 = this->raw_read_(3);

  // Restore
  CLEAR_PERI_REG_MASK(RTC_IO_HALL_SENS_REG, RTC_IO_XPD_HALL);
  CLEAR_PERI_REG_MASK(SENS_SAR_TOUCH_CTRL1_REG, SENS_XPD_HALL_FORCE_M);
  CLEAR_PERI_REG_MASK(SENS_SAR_TOUCH_CTRL1_REG, SENS_HALL_PHASE_FORCE_M);
  SET_PERI_REG_BITS(SENS_SAR_MEAS_WAIT2_REG, SENS_FORCE_XPD_SAR, 0, SENS_FORCE_XPD_SAR_S);

  int hall = (vp1 - vp0) - (vn1 - vn0);
  ESP_LOGD(TAG, "raw vp0=%d vn0=%d vp1=%d vn1=%d -> %d", vp0, vn0, vp1, vn1, hall);
  this->publish_state(hall);  // raw counts; old ESPHome scaled (x/4095*10000) to "uT"
#endif
}

void ESP32HallSensor::dump_config() { LOG_SENSOR("", "ESP32 Hall Sensor (restored)", this); }

}  // namespace esp32_hall
}  // namespace esphome
