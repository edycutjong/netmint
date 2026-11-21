<p align="center">
  <img src="docs/assets/readme-hero-animated.svg" alt="NetMint — puts each tokenised-stock supply step on trial against the chain. A pencilled supply jump meets the chain, lands within remedy, and the hallmark REAL INFLOW strikes beside +$202.83M." width="100%">
</p>

# NetMint

CoinMarketCap records every tokenised stock's circulating supply every day. NetMint turns that history into net creation and
redemption per wrapper and checks each move against the chain.

Status: early build. The full README lands with the core flow.

## Run the spike

```bash
npm ci
export CMC_API_KEY=...        # server-side only
export ALCHEMY_API_KEY=...    # archive JSON-RPC for BNB Smart Chain + Ethereum
npm run spike                 # every CMC endpoint the flow uses, verbatim bodies → docs/proof/spike/
npm run spike:chain           # block-index check + live totalSupply eth_call → docs/proof/spike/chain-boundary.json
npm run coverage:supply       # NVDA family: share of CMC supply on Ethereum + BNB Smart Chain
npm run blocks                # day-boundary block index → data/blocks/
npm run chain-supply          # daily totalSupply baseline → data/chain-supply/
npm test
```

MIT licensed.
