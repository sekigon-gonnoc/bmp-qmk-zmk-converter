import * as Hjson from "hjson";

interface QmkKeyboardInfo {
  keyboard_name?: string;
  keyboard_folder?: string;
  manufacturer?: string;
  maintainer?: string;
  url?: string;
  bootloader?: string;
  processor?: string;
  diode_direction?: string;
  features?: { [key: string]: boolean };
  matrix_pins?: {
    rows?: string[];
    cols?: string[];
  };
  split?: {
    enabled?: boolean;
    matrix_pins?: {
      right?: {
        rows?: string[];
        cols?: string[];
      };
    };
    serial?: {
      pin?: string;
      driver?: string;
    };
  };
  layouts?: {
    [layoutName: string]: {
      layout: Array<{
        matrix?: [number, number];
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        r?: number;
        rx?: number;
        ry?: number;
      }>;
    };
  };
}

function normalizeKeyboardName(name: string): string {
  return name.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_");
}

function qmkPinToZmkGpio(qmkPin: string): string {
  // Convert QMK pin names to ZMK GPIO format
  // This is a simplified conversion - you may need to adjust based on your specific hardware
  if (qmkPin.startsWith("GP")) {
    // For RP2040 GPIO pins
    const pinNum = qmkPin.slice(2);
    return `<&gpio0 ${pinNum} GPIO_ACTIVE_HIGH>`;
  } else if (qmkPin === "NO_PIN") {
    return ""; // Will be filtered out
  }
  
  // Default fallback for other pin formats
  return `<&gpio0 0 GPIO_ACTIVE_HIGH>`;
}

function generateZmkOverlay(
  keyboardInfo: QmkKeyboardInfo,
  isLeft: boolean = true,
  isSplit: boolean = false
): string {
  const matrixPins = isLeft 
    ? keyboardInfo.matrix_pins 
    : (keyboardInfo.split?.matrix_pins?.right ?? keyboardInfo.matrix_pins);

  if (!matrixPins?.rows || !matrixPins?.cols) {
    throw new Error("Matrix pins not found in keyboard info");
  }

  const rowGpios = matrixPins.rows
    .filter(pin => pin !== "NO_PIN")
    .map(pin => qmkPinToZmkGpio(pin))
    .filter(gpio => gpio !== "")
    .join("\n\t\t\t,");

  const colGpios = matrixPins.cols
    .filter(pin => pin !== "NO_PIN")
    .map(pin => qmkPinToZmkGpio(pin))
    .filter(gpio => gpio !== "")
    .join("\n\t\t\t,");

  const hasPointingDevice = keyboardInfo.features?.pointing_device === true;

  // Generate matrix transform
  const layout = keyboardInfo.layouts ? Object.values(keyboardInfo.layouts)[0]?.layout : [];
  const matrixTransform = generateMatrixTransform(layout, matrixPins.rows.length, matrixPins.cols.length);

  let trackballConfig = "";
  if (hasPointingDevice) {
    if (isSplit) {
      trackballConfig = isLeft ? `
    trackball_listener: trackball_listener {
        compatible = "zmk,input-listener";
        device = <&trackball>;
        input-processors = <&zip_xy_transform (INPUT_TRANSFORM_X_INVERT | INPUT_TRANSFORM_Y_INVERT)>;
    };` : `
    split_inputs {
        #address-cells = <1>;
        #size-cells = <0>;

        trackball_split: trackball_split@0 {
            compatible = "zmk,input-split";
            reg = <0>;
            device = <&trackball>;
        };
    };`;
    } else {
      trackballConfig = `
    trackball_listener: trackball_listener {
        compatible = "zmk,input-listener";
        device = <&trackball>;
        input-processors = <&zip_xy_transform (INPUT_TRANSFORM_X_INVERT | INPUT_TRANSFORM_Y_INVERT)>;
    };`;
    }
  }

  return `
#include <dt-bindings/zmk/matrix_transform.h>
#include <input/processors.dtsi>
#include <dt-bindings/zmk/input_transform.h>
#include "layouts.dtsi"

/ {
    chosen {
        zmk,physical-layout = &physical_layout0;
    };

    default_transform: keymap_transform_0 {
        ${matrixTransform}
    };

    kscan0: kscan {
        compatible = "zmk,kscan-gpio-matrix";
        wakeup-source;

        diode-direction = "${keyboardInfo.diode_direction === "ROW2COL" ? "row2col" : "col2row"}";
        row-gpios
            = ${rowGpios}
            ;
        col-gpios
            = ${colGpios}
            ;
    };
${trackballConfig}
};

&physical_layout0 {
    kscan = <&kscan0>;
    transform = <&default_transform>;
};
${hasPointingDevice ? generateTrackballHardwareConfig() : ""}
`;
}

function generateMatrixTransform(
  layout: Array<{
    matrix?: [number, number];
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }>,
  rows: number,
  cols: number
): string {
  if (!layout || layout.length === 0) {
    // Generate default matrix transform
    const defaultMap = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        defaultMap.push(`RC(${r},${c})`);
      }
    }
    
    return `compatible = "zmk,matrix-transform";
        columns = <${cols}>;
        rows = <${rows}>;
        map = <
            ${defaultMap.join(" ")}
        >;`;
  }

  const mapEntries = layout
    .filter(key => key.matrix)
    .map(key => `RC(${key.matrix![0]},${key.matrix![1]})`)
    .join(" ");

  return `compatible = "zmk,matrix-transform";
        columns = <${cols}>;
        rows = <${rows}>;
        map = <
            ${mapEntries}
        >;`;
}

function generateTrackballHardwareConfig(): string {
  return `
&pinctrl {
    spi0_default: spi0_default {
        group1 {
            psels = <NRF_PSEL(SPIM_SCK, 0, 12)>,
                <NRF_PSEL(SPIM_MOSI, 1, 9)>,
                <NRF_PSEL(SPIM_MISO, 1, 9)>;
        };
    };

    spi0_sleep: spi0_sleep {
        group1 {
            psels = <NRF_PSEL(SPIM_SCK, 0, 12)>,
                <NRF_PSEL(SPIM_MOSI, 1, 9)>,
                <NRF_PSEL(SPIM_MISO, 1, 9)>;
            low-power-enable;
        };
    };
};

&spi0 {
    status = "okay";
    compatible = "nordic,nrf-spim";
    pinctrl-0 = <&spi0_default>;
    pinctrl-1 = <&spi0_sleep>;
    pinctrl-names = "default", "sleep";
    cs-gpios = <&gpio0 13 GPIO_ACTIVE_LOW>;

    trackball: trackball@0 {
        status = "okay";
        compatible = "pixart,paw3222";
        reg = <0>;
        spi-max-frequency = <2000000>;
        irq-gpios = <&gpio0 15 GPIO_ACTIVE_LOW>;
    };
};
`;
}

function generateZmkLayout(keyboardInfo: QmkKeyboardInfo): string {
  const layout = keyboardInfo.layouts ? Object.values(keyboardInfo.layouts)[0]?.layout : [];
  
  if (!layout || layout.length === 0) {
    return `
#include <physical_layouts.dtsi>
/ {
    physical_layout0: physical_layout0 {
        compatible = "zmk,physical-layout";
        display-name = "Layout";
        keys = <&key_physical_attrs 100 100 0 0 0 0 0>;
    };
};
    `;
  }

  const c = (n: number) => {
    const v = Math.round(n * 100);
    return v >= 0 ? v.toString() : `(${v})`;
  };

  const keys = layout
    .map((key) => {
      const x = (key.x || 0) * 100;
      const y = (key.y || 0) * 100;
      const w = (key.w || 1) * 100;
      const h = (key.h || 1) * 100;
      const r = key.r || 0;
      const rx = (key.rx || key.x || 0) * 100;
      const ry = (key.ry || key.y || 0) * 100;

      if (r === 0) {
        return `<&key_physical_attrs ${c(w)} ${c(h)} ${c(x)} ${c(y)} 0 0 0>`;
      } else {
        return `<&key_physical_attrs ${c(w)} ${c(h)} ${c(x)} ${c(y)} ${c(r)} ${c(rx)} ${c(ry)}>`;
      }
    })
    .join("\n\t\t\t,");

  return `
#include <physical_layouts.dtsi>
/ {
    physical_layout0: physical_layout0 {
        compatible = "zmk,physical-layout";
        display-name = "Layout";
        keys
            = ${keys}
            ;
    };
};
    `;
}

function generateZmkKeymap(keyboardInfo: QmkKeyboardInfo): string {
  const layout = keyboardInfo.layouts ? Object.values(keyboardInfo.layouts)[0]?.layout : [];
  const keyCount = layout.length || 1;
  
  const bindings = Array(keyCount).fill("&none").join(" ");

  return `
#include <behaviors.dtsi>
#include <dt-bindings/zmk/keys.h>

/ {
    keymap {
        compatible = "zmk,keymap";

        layer_0 {
            bindings = <
                ${bindings}
            >;
        };

        layer_1 {
            bindings = <
                ${bindings}
            >;
        };

        layer_2 {
            bindings = <
                ${bindings}
            >;
        };

        layer_3 {
            bindings = <
                ${bindings}
            >;
        };
    };
};
`;
}

function generateZmkDefConfig(keyboardName: string, isSplit: boolean): {
  defconfig: string;
  configShield: string;
  zmkyml: string;
} {
  const normalizedName = normalizeKeyboardName(keyboardName);
  
  return {
    defconfig: `
if SHIELD_${normalizedName.toUpperCase()}${isSplit ? "_LEFT" : ""}

config ZMK_KEYBOARD_NAME
    default "${keyboardName}"

endif
${isSplit ? `
if SHIELD_${normalizedName.toUpperCase()}_LEFT || SHIELD_${normalizedName.toUpperCase()}_RIGHT

config ZMK_SPLIT
    default y

endif` : ""}`,
    
    configShield: isSplit
      ? `config SHIELD_${normalizedName.toUpperCase()}_LEFT
    def_bool $(shields_list_contains,${normalizedName}_left)
config SHIELD_${normalizedName.toUpperCase()}_RIGHT
    def_bool $(shields_list_contains,${normalizedName}_right)`
      : `
config SHIELD_${normalizedName.toUpperCase()}
    def_bool $(shields_list_contains,${normalizedName})`,
    
    zmkyml: `
file_format: "1"
id: ${normalizedName}
name: ${normalizedName}
type: shield
features:
  - keys
  - studio
outputs:
  - usb
  - ble
${isSplit ? `siblings:
  - ${normalizedName}_left
  - ${normalizedName}_right` : ""}`
  };
}

function generateZmkConfig(keyboardInfo: QmkKeyboardInfo, isSplit: boolean): string {
  const hasPointingDevice = keyboardInfo.features?.pointing_device === true;
  
  let config = "CONFIG_ZMK_STUDIO_LOCKING=n";
  
  if (hasPointingDevice) {
    config += "\nCONFIG_ZMK_POINTING=y\nCONFIG_PAW3222=y";
  }
  
  if (isSplit) {
    config += "\nCONFIG_ZMK_SPLIT_ROLE_CENTRAL=y";
  }
  
  return config;
}

export interface ZmkConfigFiles {
  overlay_left?: string;
  overlay_right?: string;
  overlay?: string;
  layouts: string;
  keymap: string;
  config_left?: string;
  config_right?: string;
  config?: string;
  defconfig: string;
  configShield: string;
  zmkyml: string;
  keyboardName: string;
  normalizedName: string;
  isSplit: boolean;
}

export function convertQmkToZmkConfig(infoJsonStr: string): ZmkConfigFiles {
  const keyboardInfo: QmkKeyboardInfo = Hjson.parse(infoJsonStr);
  
  const keyboardName = keyboardInfo.keyboard_name || 
    keyboardInfo.keyboard_folder?.split('/').pop() || 
    "unknown_keyboard";
  
  const normalizedName = normalizeKeyboardName(keyboardName);
  const isSplit = keyboardInfo.split?.enabled === true;
  
  const layouts = generateZmkLayout(keyboardInfo);
  const keymap = generateZmkKeymap(keyboardInfo);
  const defConfigs = generateZmkDefConfig(keyboardName, isSplit);
  
  const result: ZmkConfigFiles = {
    layouts,
    keymap,
    defconfig: defConfigs.defconfig,
    configShield: defConfigs.configShield,
    zmkyml: defConfigs.zmkyml,
    keyboardName,
    normalizedName,
    isSplit
  };
  
  if (isSplit) {
    result.overlay_left = generateZmkOverlay(keyboardInfo, true, true);
    result.overlay_right = generateZmkOverlay(keyboardInfo, false, true);
    result.config_left = generateZmkConfig(keyboardInfo, true);
    result.config_right = generateZmkConfig(keyboardInfo, false);
  } else {
    result.overlay = generateZmkOverlay(keyboardInfo, true, false);
    result.config = generateZmkConfig(keyboardInfo, false);
  }
  
  return result;
}
