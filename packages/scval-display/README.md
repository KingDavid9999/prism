# @prism/scval-display

ScVal display helpers shared by the frontend (`frontend/src/lib/xdr/display.ts`)
and the indexer (`indexer/src/decode.ts`), so one value renders one string in
both.

The consumers install this package from `../packages/scval-display` with
`install-links=true` (see each app's `.npmrc`), which copies it into their
`node_modules` instead of symlinking it. After changing this package:

```sh
npm ci && npm run build && npm test   # here
npm install                           # then in frontend/ and/or indexer/, to refresh the copy
```
