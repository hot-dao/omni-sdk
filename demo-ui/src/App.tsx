import React from "react";
import { ThemeProvider as StyledThemeProvider } from "styled-components";

import { useTheme } from "./theme/ThemeContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { lightTheme, darkTheme } from "./theme/theme";

import { useNearWallet } from "./hooks/near";
import { useEvmWallet } from "./hooks/evm";
import { useTonWallet } from "./hooks/ton";
import { useStellarWallet } from "./hooks/stellar";

import {
  AppContainer,
  Header,
  AccountInfo,
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
import FindDeposits from "./components/FindDeposits";

// Theme toggle icon component
const ThemeIcon = ({ isDark }: { isDark: boolean }) => (
  <span role="img" aria-label={isDark ? "Light mode" : "Dark mode"}>
    {isDark ? "☀️" : "🌙"}
  </span>
);

function AppContent() {
  const nearWallet = useNearWallet();
  const evmWallet = useEvmWallet();
  const tonWallet = useTonWallet();
  const stellarWallet = useStellarWallet();

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

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {nearWallet.accountId && (
              <AccountInfo>
                <LogoutButton onClick={nearWallet.signOut}>
                  NEAR: {nearWallet.accountId.slice(0, 6)}...{nearWallet.accountId.slice(-4)}
                </LogoutButton>
              </AccountInfo>
            )}

            {evmWallet.address && (
              <AccountInfo>
                <LogoutButton onClick={evmWallet.signOut}>
                  EVM: {evmWallet.address.slice(0, 6)}...{evmWallet.address.slice(-4)}
                </LogoutButton>
              </AccountInfo>
            )}

            {tonWallet.address && (
              <AccountInfo>
                <LogoutButton onClick={tonWallet.signOut}>
                  TON: {tonWallet.address.slice(0, 6)}...{tonWallet.address.slice(-4)}
                </LogoutButton>
              </AccountInfo>
            )}

            {stellarWallet.address && (
              <AccountInfo>
                <LogoutButton onClick={stellarWallet.signOut}>
                  STELLAR: {stellarWallet.address.slice(0, 6)}...{stellarWallet.address.slice(-4)}
                </LogoutButton>
              </AccountInfo>
            )}

            {!evmWallet.address && <LogoutButton onClick={() => evmWallet.signIn()}>Connect EVM</LogoutButton>}
            {!tonWallet.address && <LogoutButton onClick={() => tonWallet.signIn()}>Connect TON</LogoutButton>}
            {!stellarWallet.address && (
              <LogoutButton onClick={() => stellarWallet.signIn()}>Connect STELLAR</LogoutButton>
            )}
          </div>
        </Header>

        {nearWallet.accountId ? (
          <MainContent>
            <LeftColumn>
              <DepositComponent stellar={stellarWallet} evm={evmWallet} near={nearWallet} ton={tonWallet} />
              <WithdrawComponent stellar={stellarWallet} evm={evmWallet} near={nearWallet} ton={tonWallet} />
              <PendingWithdrawalsComponent evm={evmWallet} near={nearWallet} ton={tonWallet} stellar={stellarWallet} />
            </LeftColumn>
            <RightColumn>
              <BalancesComponent near={nearWallet} />
              <FindDeposits near={nearWallet} />
            </RightColumn>
          </MainContent>
        ) : (
          <LoginPrompt>
            <p>Please sign in to use the application</p>
            <StyledButton onClick={() => nearWallet.signIn()} style={{ marginTop: "10px", width: 200 }}>
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
