"""Fetch PassimPay /v2/currencies and emit SQL INSERT for payment_currencies."""
import json
import sys
import urllib.request

URL = "https://api.passimpay.io/v2/currencies"


def main() -> None:
    with urllib.request.urlopen(URL, timeout=60) as resp:
        j = json.load(resp)
    if j.get("result") != 1:
        print(j, file=sys.stderr)
        sys.exit(1)

    parts: list[str] = []
    for it in j["list"]:
        pid = str(int(it["id"]))
        sym = str(it["currency"]).upper().strip()
        net_raw = str(it.get("network") or "").strip()
        net = net_raw.upper()
        dec = int(it.get("decimals") or 18)
        name = str(it.get("name") or sym)
        label = f"{name} - {net_raw}" if net_raw else name
        req_tag = sym == "XRP" or "TON" in net

        def esc(s: str) -> str:
            return s.replace("'", "''")

        meta = json.dumps({"label": label}, ensure_ascii=False)
        meta_sql = esc(meta)

        parts.append(
            "('passimpay','"
            + esc(pid)
            + "','"
            + esc(sym)
            + "','"
            + esc(net)
            + "',"
            + str(dec)
            + ",NULL,NULL,true,true,"
            + ("true" if req_tag else "false")
            + ",'"
            + meta_sql
            + "'::jsonb)"
        )

    sql = (
        "INSERT INTO payment_currencies "
        "(provider, provider_payment_id, symbol, network, decimals, "
        "min_deposit_minor, min_withdraw_minor, deposit_enabled, withdraw_enabled, requires_tag, metadata)\nVALUES\n"
        + ",\n".join(parts)
        + "\nON CONFLICT (provider, provider_payment_id) DO UPDATE SET "
        "symbol = EXCLUDED.symbol, network = EXCLUDED.network, decimals = EXCLUDED.decimals, "
        "deposit_enabled = EXCLUDED.deposit_enabled, withdraw_enabled = EXCLUDED.withdraw_enabled, "
        "requires_tag = EXCLUDED.requires_tag, metadata = EXCLUDED.metadata, updated_at = now();"
    )
    out_path = sys.argv[1] if len(sys.argv) > 1 else "passimpay_currency_insert.sql"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(sql)


if __name__ == "__main__":
    main()
