import { useConfigStore } from "../stores/useConfigStore";

export function useColorMode() {
  const colorMode = useConfigStore((state) => state.colorMode);
  const setColorMode = useConfigStore((state) => state.setColorMode);

  const toggleColorMode = () => {
    setColorMode(colorMode === "light" ? "dark" : "light");
  };

  return { colorMode, toggleColorMode, setColorMode };
}
