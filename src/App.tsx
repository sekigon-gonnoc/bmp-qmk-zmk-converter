import { ChangeEvent, useEffect, useState } from "react";
import "./App.css";
import * as Hjson from "hjson"
import { convertQmkToZmkConfig, type ZmkConfigFiles } from "./convertToZmkConfig";
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

const keyboardListAPI = `https://api.qmk.fm/v1/keyboards`;
const keyboardAPI = `https://keyboards.qmk.fm/v1/keyboards`;

function App() {
  const [keyboardList, setKeyboardList] = useState<Array<string>>([]);
  const [keyboardListFiltered, setKeyboardListFiltered] = useState<
    Array<string>
  >([]);
  const [selectedKb, setSelectedKb] = useState("");
  const [filterText, setFilterText] = useState("");
  const [infoJson, setInfoJson] = useState("");

  useEffect(() => {
    if (keyboardList.length == 0) {
      console.log("fetch keyboard list");
      fetch(keyboardListAPI)
        .then((res) => res.json())
        .then((kb) => {
          setKeyboardList(kb);

          const filteredList = kb.filter((kb: string) => 
            kb.includes(filterText)
          );
          setKeyboardListFiltered(filteredList);

          if (filterText !== "") {
            if (filteredList.length > 0 && filteredList[0] != selectedKb) {
              setSelectedKb(filteredList[0]);
            }
          }
        })
        .catch(() => setKeyboardList(["null"]));
    }
  }, [keyboardList, filterText, selectedKb]);

  useEffect(() => {
    if (selectedKb) {
      console.log("fetch keyboard info.json");
      const kbName = selectedKb;
      fetch(`${keyboardAPI}/${kbName}/info.json`)
        .then((res) => res.json())
        .then((kb) => setInfoJson(JSON.stringify(kb.keyboards[kbName])));
    } else {
      setInfoJson("");
    }
  }, [selectedKb]);

  const handleFilterChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFilterText(event.target.value);
    const filteredList = keyboardList.filter((kb) =>
      kb.includes(event.target.value)
    );
    setKeyboardListFiltered(filteredList);
    if (filteredList.length > 0 && filteredList[0] != selectedKb) {
      setSelectedKb(filteredList[0]);
    }
  };

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value != selectedKb) {
      setSelectedKb(event.target.value);
    }
  };

  const handleGenerateClick = async () => {
    // Generate and automatically download ZMK config
    try {
      const zmk = convertQmkToZmkConfig(infoJson);
      await downloadZmkConfig(zmk);
    } catch (error) {
      console.error("ZMK config generation failed:", error);
      alert(`ZMK config generation failed: ${error}`);
    }
  };

  const downloadZmkConfig = async (zmkConfig: ZmkConfigFiles) => {
    try {
      const info = Hjson.parse(infoJson);
      const fileBaseName = info.keyboard_folder
        ? info.keyboard_folder.replaceAll("/", "_")
        : info.manufacturer + "_" + info.keyboard_name;
      
      const zipWriter = new ZipWriter(new BlobWriter('application/zip'));
      
      // Add README with keyboard info
      const readmeContent = `# ZMK Configuration for ${zmkConfig.keyboardName}

Generated from QMK info.json

## Keyboard Information
- Name: ${zmkConfig.keyboardName}
- Type: ${zmkConfig.isSplit ? 'Split' : 'Unibody'}
- Normalized Name: ${zmkConfig.normalizedName}

## Files Structure
${zmkConfig.isSplit ? `
### Split Keyboard Files
- boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}_left.overlay - Left side hardware definition
- boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}_right.overlay - Right side hardware definition
- boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}_left.conf - Left side configuration
- boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}_right.conf - Right side configuration
` : `
### Unibody Keyboard Files
- boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}.overlay - Hardware definition
- boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}.conf - Configuration
`}
### Common Files
- boards/shields/${zmkConfig.normalizedName}/layouts.dtsi - Physical layout definition
- boards/shields/${zmkConfig.normalizedName}/Kconfig.defconfig - Default configuration
- boards/shields/${zmkConfig.normalizedName}/Kconfig.shield - Shield configuration
- boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}.zmk.yml - ZMK metadata
- config/keymap.keymap - Keymap definition

## Usage
1. Copy the boards/shields/${zmkConfig.normalizedName}/ directory to your ZMK config
2. Copy the config/keymap.keymap to your ZMK config
3. Update your build configuration to include the new shield
4. Customize the keymap as needed
`;

      await zipWriter.add('README.md', new TextReader(readmeContent));
      
      // Add shield files
      if (zmkConfig.isSplit) {
        await zipWriter.add(
          `boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}_left.overlay`,
          new TextReader(zmkConfig.overlay_left!)
        );
        await zipWriter.add(
          `boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}_right.overlay`,
          new TextReader(zmkConfig.overlay_right!)
        );
        await zipWriter.add(
          `boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}_left.conf`,
          new TextReader(zmkConfig.config_left!)
        );
        await zipWriter.add(
          `boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}_right.conf`,
          new TextReader(zmkConfig.config_right!)
        );
      } else {
        await zipWriter.add(
          `boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}.overlay`,
          new TextReader(zmkConfig.overlay!)
        );
        await zipWriter.add(
          `boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}.conf`,
          new TextReader(zmkConfig.config!)
        );
      }
      
      // Add common files
      await zipWriter.add(
        `boards/shields/${zmkConfig.normalizedName}/layouts.dtsi`,
        new TextReader(zmkConfig.layouts)
      );
      await zipWriter.add(
        `boards/shields/${zmkConfig.normalizedName}/Kconfig.defconfig`,
        new TextReader(zmkConfig.defconfig)
      );
      await zipWriter.add(
        `boards/shields/${zmkConfig.normalizedName}/Kconfig.shield`,
        new TextReader(zmkConfig.configShield)
      );
      await zipWriter.add(
        `boards/shields/${zmkConfig.normalizedName}/${zmkConfig.normalizedName}.zmk.yml`,
        new TextReader(zmkConfig.zmkyml)
      );
      await zipWriter.add(
        'config/keymap.keymap',
        new TextReader(zmkConfig.keymap)
      );
      
      // Generate and download the ZIP file
      const zipBlob = await zipWriter.close();
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${fileBaseName}_zmk_config.zip`);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      
    } catch (error) {
      throw new Error(`Failed to create ZMK config ZIP: ${error}`);
    }
  };

  const handleInfoTextAreaChange = (
    event: ChangeEvent<HTMLTextAreaElement>
  ) => {
    setInfoJson(event.target.value);
  };


  return (
    <div className="grid-container">
      <div className="grid-row">
        <textarea
          value={infoJson}
          onChange={handleInfoTextAreaChange}
          placeholder="info.json"
        ></textarea>
      </div>
      <div className="grid-row-2">
        <input
          type="text"
          placeholder="絞り込みテキスト"
          value={filterText}
          onChange={handleFilterChange}
        />
        <select value={selectedKb} onChange={handleSelectChange}>
          <option value="">選択してください</option>
          {keyboardListFiltered.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button onClick={handleGenerateClick}>Generate</button>
      </div>
    </div>
  );
}

export default App;
