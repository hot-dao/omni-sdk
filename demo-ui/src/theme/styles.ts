import styled, { createGlobalStyle } from "styled-components";
import { lightTheme, darkTheme } from "./theme";

// Define a type for our theme
type ThemeType = typeof lightTheme;

// Override the default theme type
declare module "styled-components" {
  export interface DefaultTheme extends ThemeType {}
}

// Create a global style
export const GlobalStyle = createGlobalStyle<{ theme: ThemeType }>`
  body {
    background-color: ${({ theme }) => theme.background};
    color: ${({ theme }) => theme.text};
    transition: all 0.3s ease;
    margin: 0;
    padding: 0;
  }
`;

export const ThemeToggleButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.text};
  font-size: 24px;
  cursor: pointer;
  margin-left: 16px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  transition: background-color 0.2s;

  &:hover {
    background-color: rgba(128, 128, 128, 0.1);
  }
`;

export const AppContainer = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans",
    "Helvetica Neue", sans-serif;
`;

export const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 15px;
  border-bottom: 1px solid ${({ theme }) => theme.headerBorder};

  h1 {
    margin: 0;
    color: ${({ theme }) => theme.text};
  }
`;

export const AccountInfo = styled.div`
  display: flex;
  align-items: center;
  font-size: 14px;

  span {
    color: ${({ theme }) => theme.accountText};
    margin-right: 5px;
  }
`;

export const AccountId = styled.div`
  background: ${({ theme }) => theme.accountBg};
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  margin-right: 10px;
  color: ${({ theme }) => theme.text};
`;

export const LogoutButton = styled.button`
  padding: 5px 10px;
  background-color: ${({ theme }) => theme.accountBg};
  color: ${({ theme }) => theme.accountText};
  border: 1px solid ${({ theme }) => theme.inputBorder};
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: ${({ theme }) => (theme.accountText === "#666666" ? "#e6e6e6" : "#444444")};
    color: ${({ theme }) => theme.text};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const MainContent = styled.div`
  display: flex;
  gap: 30px;

  @media (max-width: 768px) {
    flex-direction: column;
  }
`;

export const LeftColumn = styled.div`
  flex: 1;
`;

export const RightColumn = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

export const Card = styled.div`
  background: ${({ theme }) => theme.cardBackground};
  border-radius: 12px;
  box-shadow: ${({ theme }) => theme.cardShadow};
  padding: 20px;
  margin-bottom: 20px;

  h3 {
    margin-top: 0;
    margin-bottom: 15px;
    font-size: 18px;
    color: ${({ theme }) => theme.text};
  }
`;

export const BalancesContainer = styled(Card)`
  max-height: 400px;
  width: 400px;
  overflow-y: auto;
  margin-top: 0;
`;

export const StyledInput = styled.input`
  width: 100%;
  padding: 12px;
  border: 1px solid ${({ theme }) => theme.inputBorder};
  border-radius: 6px;
  font-size: 14px;
  background-color: ${({ theme }) => theme.cardBackground};
  color: ${({ theme }) => theme.text};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.buttonPrimary};
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
  }
`;

export const StyledButton = styled.button`
  width: 100%;
  padding: 12px;
  background-color: ${({ theme }) => theme.buttonPrimary};
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: ${({ theme }) => theme.buttonPrimaryHover};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const TokenCard = styled.div`
  display: flex;
  align-items: center;
  border: 1px solid ${({ theme }) => theme.tokenCardBorder};
  border-radius: 8px;
  overflow: hidden;
  padding: 12px;
  margin-bottom: 10px;
  gap: 10px;
  transition: transform 0.2s, box-shadow 0.2s;
  background-color: ${({ theme }) => theme.cardBackground};

  &:hover {
    transform: translateY(-2px);
    box-shadow: ${({ theme }) => theme.tokenCardHoverShadow};
  }

  p {
    margin: 0;
    font-size: 13px;
    color: ${({ theme }) => theme.accountText};
  }

  p:last-child {
    font-size: 15px;
    font-weight: 600;
    color: ${({ theme }) => theme.text};
  }
`;

export const TokenImage = styled.img`
  width: 36px;
  height: 36px;
  background: ${({ theme }) => theme.inputBorder};
  border-radius: 50%;
  object-fit: cover;
`;

export const ChainImage = styled.img`
  width: 16px;
  height: 16px;
  background: ${({ theme }) => theme.inputBorder};
  margin-left: -24px;
  margin-bottom: -30px;
  border-radius: 50%;
  border: 1px solid #ccc;
`;

export const EmptyState = styled.div`
  padding: 20px;
  text-align: center;
  color: ${({ theme }) => theme.accountText};
  font-size: 14px;
  border: 1px dashed ${({ theme }) => theme.tokenCardBorder};
  border-radius: 8px;
`;

export const LoginPrompt = styled.div`
  text-align: center;
  padding: 40px;
  background: ${({ theme }) => theme.loginPromptBg};
  border-radius: 12px;

  p {
    color: ${({ theme }) => theme.accountText};
    margin-bottom: 20px;
  }
`;

export const ErrorMessage = styled.div`
  padding: 10px;
  margin-bottom: 15px;
  color: ${({ theme }) => theme.errorText};
  border-radius: 4px;
  font-size: 14px;
  text-align: center;
`;

export const SuccessMessage = styled.div`
  padding: 10px;
  margin-bottom: 15px;
  background-color: ${({ theme }) => theme.successBg};
  border: 1px solid ${({ theme }) => theme.successText};
  color: ${({ theme }) => theme.successText};
  border-radius: 4px;
  font-size: 14px;
`;

export const LoadingContainer = styled.div`
  padding: 40px;
  text-align: center;
  color: ${({ theme }) => theme.accountText};
  font-size: 14px;
  border: 1px dashed ${({ theme }) => theme.tokenCardBorder};
  border-radius: 8px;
  width: 400px;
`;

export const WithdrawalsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
`;

export const WithdrawalCard = styled.div`
  border: 1px solid ${({ theme }) => theme.tokenCardBorder};
  border-radius: 8px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.cardBackground};
`;

export const WithdrawalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background-color: ${({ theme }) => theme.withdrawalHeaderBg};
  border-bottom: 1px solid ${({ theme }) => theme.tokenCardBorder};
  font-weight: 500;
  color: ${({ theme }) => theme.text};
`;

export const StatusBadge = styled.span`
  background-color: ${({ theme }) => theme.statusBadgeBg};
  color: ${({ theme }) => theme.statusBadgeText};
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
`;

export const WithdrawalDetails = styled.div`
  padding: 12px;
`;

export const WithdrawalDetail = styled.div`
  display: flex;
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
`;

export const DetailLabel = styled.span`
  width: 80px;
  color: ${({ theme }) => theme.accountText};
  font-size: 13px;
`;

export const DetailValue = styled.span`
  font-weight: 500;
  color: ${({ theme }) => theme.text};
  font-size: 13px;
`;

export const BalanceSection = styled.div`
  margin-bottom: 20px;
`;

export const BalanceSectionTitle = styled.h4`
  font-size: 15px;
  color: ${({ theme }) => theme.accountText};
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid ${({ theme }) => theme.tokenCardBorder};
  margin-top: 0;
`;

export const TokenName = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.accountText};
`;

export const TokenAmount = styled.p`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.text};
`;

export const FormContainer = styled.form`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const Input = styled.input`
  padding: 10px 12px;
  border: 1px solid ${({ theme }) => theme.inputBorder};
  border-radius: 6px;
  font-size: 14px;
  background-color: ${({ theme }) => theme.cardBackground};
  color: ${({ theme }) => theme.text};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.buttonPrimary};
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
  }
`;

export const Select = styled.select`
  padding: 10px 12px;
  border: 1px solid ${({ theme }) => theme.inputBorder};
  border-radius: 6px;
  font-size: 14px;
  appearance: auto;
  background-color: ${({ theme }) => theme.cardBackground};
  color: ${({ theme }) => theme.text};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.buttonPrimary};
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
  }
`;

export const Button = styled.button`
  padding: 12px;
  background-color: ${({ theme }) => theme.buttonPrimary};
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: ${({ theme }) => theme.buttonPrimaryHover};
  }

  &:disabled {
    background-color: ${({ theme }) => theme.buttonDisabled};
    cursor: not-allowed;
  }
`;

export const InputLabel = styled.label`
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 4px;
  color: ${({ theme }) => theme.accountText};
`;

export const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
`;
