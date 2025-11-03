

https://github.com/user-attachments/assets/4672a13f-007f-4078-9052-e4b4e6776f08



Goal: check the solana breakpoint cms for new sponsors, and compare that with `constants-grid.js` to see if any are missing in the constants file.

1. `cp .env.example .env`
1. Add SANITY_API_READ_TOKEN
1. Get most recent constants file from: https://github.com/solana-foundation/solana-com-breakpoint/blob/main/components/SponsorModal/constants-grid.ts
1. Paste into the `constants-grid.js` file in this repo
1. Run `node check-sponsors-standalone.js`

Outputs:
1. table in the terminal
2. csv output
