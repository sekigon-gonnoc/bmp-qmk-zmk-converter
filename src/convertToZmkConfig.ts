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
  matrix_size?: {
    cols: number;
    rows: number;
  };
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

function qmkPinToZmkGpio(qmkPin: string, isRow: boolean, diodeDirection: string): string {
  const PIN_TABLE:{ [key: string]: [number, number] } = {
    D3: [0, 8],
    D2: [0,11],
    D1: [0,18],
    D0: [0,16],
    D4: [0,19],
    C6: [0,20],
    D7: [0,22],
    E6: [0,23],
    B4: [1,0],
    B5: [1,3],
    B6: [0,19],
    B2: [0,0],
    B3: [1,15],
    B1: [1,14],
    F7: [0,3],
    F6: [0,30],
    F5: [0,0],
    F4: [0,5],
  };

  if (qmkPin === "NO_PIN") {
    return ""; // Will be filtered out
  }

  // Determine GPIO configuration based on row/column and diode direction
  let gpioFlags = "";
  
  if (diodeDirection === "COL2ROW") {
    // COL2ROW: columns are driven, rows are sensed
    if (isRow) {
      // Rows need pull-down and are active high when key is pressed
      gpioFlags = "(GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)";
    } else {
      // Columns are driven active high
      gpioFlags = "GPIO_ACTIVE_HIGH";
    }
  } else { // ROW2COL
    // ROW2COL: rows are driven, columns are sensed
    if (isRow) {
      // Rows are driven active high
      gpioFlags = "GPIO_ACTIVE_HIGH";
    } else {
      // Columns need pull-down and are active high when key is pressed
      gpioFlags = "(GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)";
    }
  }

  if (PIN_TABLE[qmkPin] !== undefined) {
    return `<&gpio${PIN_TABLE[qmkPin][0]} ${PIN_TABLE[qmkPin][1]} ${gpioFlags}>`;
  }

  // Handle GP pins for RP2040
  if (qmkPin.startsWith("GP")) {
    const pinNum = qmkPin.slice(2);
    return `<&gpio0 ${pinNum} ${gpioFlags}>`;
  }

  // Default fallback
  return `<&gpio0 0 ${gpioFlags}>`;
}

function generateMatrixTransform(
  layout: Array<{
    matrix?: [number, number];
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }>,
  matrixInfo: {
    rows: number;
    cols: number;
    totalRows: number;
    totalCols: number;
    isSplit: boolean;
    isLeft: boolean;
    leftCols: number;
  }
): string {
  const { rows, cols, totalRows, totalCols, isSplit, isLeft, leftCols } = matrixInfo;

  if (!layout || layout.length === 0) {
    if (!isSplit) {
      // Unibody keyboard - generate sequential matrix mapping
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
    } else {
      // Split keyboard - use col-offset for right side
      const colOffset = isLeft ? 0 : leftCols;
      const defaultMap = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          defaultMap.push(`RC(${r},${c})`);
        }
      }
      
      return `compatible = "zmk,matrix-transform";
        columns = <${totalCols}>;
        rows = <${totalRows}>;
        map = <
            ${defaultMap.join(" ")}
        >;${colOffset > 0 ? `\n        col-offset = <${colOffset}>;` : ""}`;
    }
  }

  if (!isSplit) {
    // Unibody keyboard
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
  } else {
    // Split keyboard
    const validKeys = layout.filter(key => key.matrix);
    
    if (validKeys.length === 0) {
      const colOffset = isLeft ? 0 : leftCols;
      return `compatible = "zmk,matrix-transform";
        columns = <${totalCols}>;
        rows = <${totalRows}>;
        map = <RC(0,0)>;${colOffset > 0 ? `\n        col-offset = <${colOffset}>;` : ""}`;
    }

    // For split keyboards, map keys using local matrix coordinates
    // ZMK will handle the column offset automatically
    const mapEntries = validKeys
      .map(key => {
        const [row, col] = key.matrix!;
        return `RC(${row},${col})`;
      })
      .join(" ");

    const colOffset = isLeft ? 0 : leftCols;

    return `compatible = "zmk,matrix-transform";
        columns = <${totalCols}>;
        rows = <${totalRows}>;
        map = <
            ${mapEntries}
        >;${colOffset > 0 ? `\n        col-offset = <${colOffset}>;` : ""}`;
  }
}

function getMatrixDimensions(keyboardInfo: QmkKeyboardInfo, isLeft: boolean = true): {
  rows: number;
  cols: number;
  totalRows: number;
  totalCols: number;
  leftCols: number;
  rightCols: number;
} {
  // Get matrix dimensions from matrix_size if available
  if (keyboardInfo.matrix_size) {
    const { rows, cols } = keyboardInfo.matrix_size;
    
    if (!keyboardInfo.split?.enabled) {
      // Unibody keyboard
      return {
        rows,
        cols,
        totalRows: rows,
        totalCols: cols,
        leftCols: cols,
        rightCols: 0
      };
    } else {
      // Split keyboard
      // QMK concatenates split keyboards in row direction (doubling rows)
      // ZMK concatenates in column direction (doubling columns)
      
      // For QMK split: total_rows = rows * 2, each side has 'rows' rows and 'cols' columns
      // For ZMK split: total_cols = cols * 2, each side has 'rows' rows and 'cols' columns
      const sideRows = rows / 2; // QMK doubles rows for split
      const sideCols = cols; // Each side has full column count
      
      return {
        rows: sideRows,
        cols: sideCols,
        totalRows: sideRows,
        totalCols: sideCols * 2, // ZMK doubles columns for split
        leftCols: sideCols,
        rightCols: sideCols
      };
    }
  }
  
  // Fallback to matrix_pins if matrix_size is not available
  const leftPins = keyboardInfo.matrix_pins;
  const rightPins = keyboardInfo.split?.matrix_pins?.right;
  
  if (!leftPins?.rows || !leftPins?.cols) {
    throw new Error("Matrix dimensions not found in keyboard info");
  }
  
  const leftRows = leftPins.rows.filter(pin => pin !== "NO_PIN").length;
  const leftCols = leftPins.cols.filter(pin => pin !== "NO_PIN").length;
  
  if (!keyboardInfo.split?.enabled) {
    return {
      rows: leftRows,
      cols: leftCols,
      totalRows: leftRows,
      totalCols: leftCols,
      leftCols: leftCols,
      rightCols: 0
    };
  }
  
  const rightRows = rightPins?.rows?.filter(pin => pin !== "NO_PIN").length || leftRows;
  const rightCols = rightPins?.cols?.filter(pin => pin !== "NO_PIN").length || leftCols;
  
  return {
    rows: isLeft ? leftRows : rightRows,
    cols: isLeft ? leftCols : rightCols,
    totalRows: Math.max(leftRows, rightRows),
    totalCols: leftCols + rightCols,
    leftCols: leftCols,
    rightCols: rightCols
  };
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

  const diodeDirection = keyboardInfo.diode_direction || "COL2ROW";

  const rowGpios = matrixPins.rows
    .filter(pin => pin !== "NO_PIN")
    .map(pin => qmkPinToZmkGpio(pin, true, diodeDirection))
    .filter(gpio => gpio !== "")
    .join("\n\t\t\t,");

  const colGpios = matrixPins.cols
    .filter(pin => pin !== "NO_PIN")
    .map(pin => qmkPinToZmkGpio(pin, false, diodeDirection))
    .filter(gpio => gpio !== "")
    .join("\n\t\t\t,");

  // Get matrix dimensions
  const matrixDims = getMatrixDimensions(keyboardInfo, isLeft);
  
  // Generate matrix transform with proper split keyboard support
  const layout = keyboardInfo.layouts ? Object.values(keyboardInfo.layouts)[0]?.layout : [];
  
  // Filter layout for current side in split keyboard
  let sideLayout = layout;
  if (isSplit && layout.length > 0) {
    // For split keyboards, filter keys based on matrix column ranges
    const leftColMax = matrixDims.leftCols - 1;
    
    if (isLeft) {
      sideLayout = layout.filter(key => 
        key.matrix && key.matrix[1] <= leftColMax
      );
    } else {
      sideLayout = layout.filter(key => 
        key.matrix && key.matrix[1] > leftColMax
      ).map(key => ({
        ...key,
        matrix: key.matrix ? [key.matrix[0], key.matrix[1] - matrixDims.leftCols] as [number, number] : undefined
      }));
    }
  }

  const matrixTransform = generateMatrixTransform(sideLayout, {
    rows: matrixDims.rows,
    cols: matrixDims.cols,
    totalRows: matrixDims.totalRows,
    totalCols: matrixDims.totalCols,
    isSplit,
    isLeft,
    leftCols: matrixDims.leftCols
  });

  return `
#include <dt-bindings/zmk/matrix_transform.h>
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

        diode-direction = "${diodeDirection === "ROW2COL" ? "row2col" : "col2row"}";
        row-gpios
            = ${rowGpios}
            ;
        col-gpios
            = ${colGpios}
            ;
    };
};

&physical_layout0 {
    kscan = <&kscan0>;
    transform = <&default_transform>;
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
      const x = (key.x || 0);
      const y = (key.y || 0);
      const w = (key.w || 1);
      const h = (key.h || 1);
      const r = key.r || 0;
      const rx = (key.rx || key.x || 0);
      const ry = (key.ry || key.y || 0);

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

function generateShieldKeymap(): string {
  return `#include <behaviors.dtsi>
#include <dt-bindings/zmk/keys.h>

#include "../../../config/keymap.keymap"`;
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
  let config = "CONFIG_ZMK_STUDIO_LOCKING=n";
  
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
  shieldKeymap?: string;
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
  const shieldKeymap = generateShieldKeymap();
  const defConfigs = generateZmkDefConfig(keyboardName, isSplit);
  
  const result: ZmkConfigFiles = {
    layouts,
    keymap,
    shieldKeymap,
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
