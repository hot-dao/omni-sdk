import mapValues from "lodash/mapValues";
import { OMNI_HOT_V2 } from "./utils";
import OmniService from "./bridge";

class OmniV2 {
  public assets: string[][] = [];
  constructor(private readonly user: OmniService) {}

  get near() {
    if (this.user.near == null) throw "Connect NEAR to use OmniV2";
    return this.user.near;
  }

  async getLiquidityBalances(account: string) {
    const balances = await this.near.viewFunction({ contractId: OMNI_HOT_V2, methodName: "get_balance", args: { account_id: account } });
    return mapValues(balances, (t) => BigInt(t));
  }

  _groups: Record<string, { group: string; decimal: number }> | null = null;
  async getStableGroups(): Promise<Record<string, { group: string; decimal: number }>> {
    if (this._groups) return this._groups;
    const groups = await this.near.viewFunction({ contractId: "stable-swap.hot.tg", methodName: "get_groups" });

    const _groups: Record<string, { group: string; decimal: number }> = {};
    groups.forEach((t: any) => (_groups[t.contract_id] = { group: t.group_id, decimal: t.decimal }));

    this._groups = _groups;
    return _groups;
  }

  async getOmniBalances() {
    const balances = await this.getLiquidityBalances(this.near.address);
    const groups: { contract_id: string; group_id: string }[] = await this.near.viewFunction({
      contractId: "stable-swap.hot.tg",
      methodName: "get_groups",
    });

    const list: Record<string, string[]> = {};
    groups.map(async ({ contract_id, group_id }) => {
      if (list[group_id] == null) list[group_id] = [];
      list[group_id].push(contract_id);
    });

    Object.keys(balances).forEach((id) => {
      const group = groups.find((t) => t.contract_id === id)?.group_id || id;
      if (list[group] == null) list[group] = [];
      if (list[group].includes(id)) return;
      list[group].push(id);
    });

    return balances;
  }
}

export default OmniV2;
