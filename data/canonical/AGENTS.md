# Canonical Market Series Notes

Files in this directory are canonical app inputs derived from provider-normalized snapshots under `data/sources/`.

The v1 canonical series pattern rebases each source `adjusted_close` value to 100 at the first observation: `total_return_index = source_value / first_source_value * 100`.

Each canonical file must keep one symbol/provider/frequency combination and clearly reflect that source in the filename and CSV metadata. ETF adjusted-close datasets are market proxies, not official total return indexes.
