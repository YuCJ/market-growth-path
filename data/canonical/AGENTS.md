# Canonical Market Series Notes

`data/canonical/market-total-return-vt-weekly.v1.csv` is derived from `data/sources/alpha-vantage/VT/weekly-adjusted/2026-06-14.manual.csv`.

The v1 canonical series rebases the source `adjusted_close` value to 100 at the first observation: `total_return_index = source_value / first_source_value * 100`.

This dataset currently represents `VT` as a global equity ETF adjusted-close proxy. If the project switches to IWDA, VTI, or another provider, create or rebuild a canonical file with the target symbol/provider clearly reflected in the filename.
