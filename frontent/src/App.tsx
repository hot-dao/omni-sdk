import React from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ThemeProvider as StyledThemeProvider } from "styled-components";

import { useTheme } from "./theme/ThemeContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { lightTheme, darkTheme } from "./theme/theme";
import { useNearWallet } from "./hooks/near";

import {
  AppContainer,
  Header,
  AccountInfo,
  AccountId,
  MainContent,
  LeftColumn,
  RightColumn,
  LoginPrompt,
  StyledButton,
  LogoutButton,
  GlobalStyle,
  ThemeToggleButton,
} from "./theme/styles";

// Import components
import BalancesComponent from "./components/BalancesComponent";
import DepositComponent from "./components/DepositComponent";
import WithdrawComponent from "./components/WithdrawComponent";
import PendingWithdrawalsComponent from "./components/PendingWithdrawals";

// Theme toggle icon component
const ThemeIcon = ({ isDark }: { isDark: boolean }) => (
  <span role="img" aria-label={isDark ? "Light mode" : "Dark mode"}>
    {isDark ? "☀️" : "🌙"}
  </span>
);

function AppContent() {
  const { wallet, signIn, signOut } = useNearWallet();
  const { theme, toggleTheme } = useTheme();
  const themeObj = theme === "light" ? lightTheme : darkTheme;

  return (
    <StyledThemeProvider theme={themeObj}>
      <GlobalStyle theme={themeObj} />
      <AppContainer>
        <Header>
          <div style={{ display: "flex", alignItems: "center" }}>
            <h1>HOT Bridge</h1>
            <ThemeToggleButton onClick={toggleTheme}>
              <ThemeIcon isDark={theme === "dark"} />
            </ThemeToggleButton>
          </div>

          {wallet && (
            <AccountInfo>
              <span>Connected: </span>
              <AccountId>{wallet.accountId}</AccountId>
              <LogoutButton onClick={signOut}>Logout</LogoutButton>
            </AccountInfo>
          )}

          <ConnectButton showBalance={false} />
        </Header>

        {wallet ? (
          <MainContent>
            <LeftColumn>
              <DepositComponent />
              <WithdrawComponent />
              <PendingWithdrawalsComponent />
            </LeftColumn>
            <RightColumn>
              <BalancesComponent />
            </RightColumn>
          </MainContent>
        ) : (
          <LoginPrompt>
            <p>Please sign in to use the application</p>
            <StyledButton onClick={signIn} style={{ marginTop: "10px", width: 200 }}>
              Sign In
            </StyledButton>
          </LoginPrompt>
        )}
      </AppContainer>
    </StyledThemeProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
