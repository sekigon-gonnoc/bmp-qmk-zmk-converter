import { ChangeEvent, useEffect, useState } from "react";
import {
  convertInfoJsonToConfigJson,
  validateConfigJson,
} from "./convertToConfigJson";
import { convertToVialJson } from "./convertToVialJson";
import init, { xz_compress } from "./pkg";
import "./App.css";
import { convertToBmpVialBin } from "./convertToBmpVialBin";
import * as bmpKeycodes from './bmpKeycodes.json'
import * as bmpCustomMenus from './bmpCustomMenus.json'
import * as Hjson from "hjson"
import { convertQmkToZmkConfig, type ZmkConfigFiles } from "./convertToZmkConfig";

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
  const [configJson, setConfigJson] = useState("");
  const [vialJson, setVialJson] = useState("");
  const [configType, setConfigType] = useState("");
  const [configTypeList, setConfigTypeList] = useState<{ [key: string]: any }>(
    {}
  );
  const [zmkConfig, setZmkConfig] = useState<ZmkConfigFiles | null>(null);

  useEffect(() => {
    console.log("load wasm");
    init();
  }, []);

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

  useEffect(() => {
    if (configType !== "") {
      if (configType in configTypeList) {
        setConfigJson(JSON.stringify(configTypeList[configType], null, 4));
      } else {
        setConfigJson("");
      }
    }
  }, [configTypeList, configType]);

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

  const handleSelectConfigChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value != configType) {
      setConfigType(event.target.value);
    }
  };

  const handleInfoTextAreaChange = (
    event: ChangeEvent<HTMLTextAreaElement>
  ) => {
    setInfoJson(event.target.value);
  };

  const handleGenerateClick = () => {
    try {
      const config = convertInfoJsonToConfigJson(Hjson.parse(infoJson));
      setConfigTypeList(config);
      if (config.single) {
        setConfigType("single");
      } else if (config.master) {
        setConfigType("master");
      }
    } catch (error) {
      alert(error);
      setConfigTypeList({});
    }

    const vial = convertToVialJson(Hjson.parse(infoJson));
    setVialJson(JSON.stringify(vial, null, 4));

    // Generate ZMK config
    try {
      const zmk = convertQmkToZmkConfig(infoJson);
      setZmkConfig(zmk);
    } catch (error) {
      console.error("ZMK config generation failed:", error);
      setZmkConfig(null);
    }
  };

  const handleConfigTextAreaChange = (
    event: ChangeEvent<HTMLTextAreaElement>
  ) => {
    setConfigJson(event.target.value);
  };

  const handleVialTextAreaChange = (
    event: ChangeEvent<HTMLTextAreaElement>
  ) => {
    setVialJson(event.target.value);
  };

  const downloadData = (data: any, name: string) => {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([data]));
    link.setAttribute("href", url);
    link.setAttribute("download", name);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadClick = () => {
    try {
      Hjson.parse(vialJson);
    } catch (error) {
      alert("Invalid vial Hjson");
      return;
    }

    try {
      Hjson.parse(configJson);
    } catch (error) {
      alert("Invalid config Hjson");
      return;
    }

    const vialData = xz_compress(vialJson.slice());
    const bmpVialBin = convertToBmpVialBin(
      vialData,
      Hjson.parse(configJson).config
    );

      try {
        const info = Hjson.parse(infoJson);
        const fileBaseName = info.keyboard_folder
          ? info.keyboard_folder.replaceAll("/", "_")
          : info.manufacturer + "_" + info.keyboard_name;
        downloadData(
          bmpVialBin.$arrayBuffer,
          `${fileBaseName}_${configType}_config.bin`
        );
      } catch (error) {
        alert(error);
      }
  };

  const handleAppendBmpCustomKeycodesClick = () => {
    try {
      const json = JSON.stringify(
        {
          ...Hjson.parse(vialJson),
          customKeycodes: bmpKeycodes.customKeycodes,
          menus: bmpCustomMenus.menus,
        },
        null,
        4
      );
      setVialJson(json);
    } catch (error) {
      alert("Invalid vial Hjson");
    }
  };

  const handleDownloadVialJsonClick = () => {
    try {
      Hjson.parse(vialJson);
      const info = Hjson.parse(infoJson);
      const fileBaseName = info.keyboard_folder
        ? info.keyboard_folder.replaceAll("/", "_")
        : info.manufacturer + "_" + info.keyboard_name;
      downloadData(vialJson, `${fileBaseName}_vial.json`);
    } catch (error) {
      alert("Invalid vial Hjson");
      return;
    }
  };

  const handleDownloadConfigJsonClick = () => {
    try {
      const config = Hjson.parse(configJson);
      validateConfigJson(config);
      const info = Hjson.parse(infoJson);
      const fileBaseName = info.keyboard_folder
        ? info.keyboard_folder.replaceAll("/", "_")
        : info.manufacturer + "_" + info.keyboard_name;
      downloadData(configJson, `${fileBaseName}_${configType}_config.json`);
    } catch (error) {
      alert(`Invalid config json\n${error}`);
      return;
    }
  };

  const handleDownloadZmkConfigClick = () => {
    if (!zmkConfig) {
      alert("No ZMK config generated");
      return;
    }

    try {
      const info = Hjson.parse(infoJson);
      const fileBaseName = info.keyboard_folder
        ? info.keyboard_folder.replaceAll("/", "_")
        : info.manufacturer + "_" + info.keyboard_name;
      
      // Create a comprehensive config file
      let zmkConfigText = `# ZMK Configuration for ${zmkConfig.keyboardName}\n`;
      zmkConfigText += `# Generated from QMK info.json\n\n`;
      
      if (zmkConfig.isSplit) {
        zmkConfigText += `## Left Side Files:\n`;
        zmkConfigText += `### ${zmkConfig.normalizedName}_left.overlay\n`;
        zmkConfigText += "```\n" + zmkConfig.overlay_left + "\n```\n\n";
        zmkConfigText += `### ${zmkConfig.normalizedName}_left.conf\n`;
        zmkConfigText += "```\n" + zmkConfig.config_left + "\n```\n\n";
        
        zmkConfigText += `## Right Side Files:\n`;
        zmkConfigText += `### ${zmkConfig.normalizedName}_right.overlay\n`;
        zmkConfigText += "```\n" + zmkConfig.overlay_right + "\n```\n\n";
        zmkConfigText += `### ${zmkConfig.normalizedName}_right.conf\n`;
        zmkConfigText += "```\n" + zmkConfig.config_right + "\n```\n\n";
      } else {
        zmkConfigText += `## Main Files:\n`;
        zmkConfigText += `### ${zmkConfig.normalizedName}.overlay\n`;
        zmkConfigText += "```\n" + zmkConfig.overlay + "\n```\n\n";
        zmkConfigText += `### ${zmkConfig.normalizedName}.conf\n`;
        zmkConfigText += "```\n" + zmkConfig.config + "\n```\n\n";
      }
      
      zmkConfigText += `## Common Files:\n`;
      zmkConfigText += `### layouts.dtsi\n`;
      zmkConfigText += "```\n" + zmkConfig.layouts + "\n```\n\n";
      zmkConfigText += `### keymap.keymap\n`;
      zmkConfigText += "```\n" + zmkConfig.keymap + "\n```\n\n";
      zmkConfigText += `### Kconfig.defconfig\n`;
      zmkConfigText += "```\n" + zmkConfig.defconfig + "\n```\n\n";
      zmkConfigText += `### Kconfig.shield\n`;
      zmkConfigText += "```\n" + zmkConfig.configShield + "\n```\n\n";
      zmkConfigText += `### ${zmkConfig.normalizedName}.zmk.yml\n`;
      zmkConfigText += "```\n" + zmkConfig.zmkyml + "\n```\n";
      
      downloadData(zmkConfigText, `${fileBaseName}_zmk_config.md`);
    } catch (error) {
      alert("Failed to generate ZMK config");
    }
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
        {zmkConfig && (
          <button onClick={handleDownloadZmkConfigClick}>Download ZMK Config</button>
        )}
      </div>
      {zmkConfig && (
        <div className="grid-row">
          <div style={{ padding: '10px', backgroundColor: '#f0f0f0', margin: '10px 0' }}>
            <h3>ZMK Config Generated</h3>
            <p>Keyboard: {zmkConfig.keyboardName}</p>
            <p>Type: {zmkConfig.isSplit ? 'Split' : 'Unibody'}</p>
            <p>Files: {zmkConfig.isSplit ? 'Left/Right overlays, configs, and common files' : 'Single overlay, config, and common files'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
