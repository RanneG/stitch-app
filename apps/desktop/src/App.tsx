import StitchAppRoot from "./components/StitchAppRoot";
import { ThemeProvider } from "./context/ThemeContext";

function App() {
  return (
    <ThemeProvider>
      <StitchAppRoot />
    </ThemeProvider>
  );
}

export default App;
