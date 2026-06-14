請建立一個市場長期成長路徑的時間序列分析與視覺化專案。

## 目標

使用使用者選擇的一份 canonical 歷史市場資料，建立並比較以下兩種長期成長模型：

1. Log-linear deterministic trend
   對數線性確定性趨勢模型

2. Random walk with drift
   帶漂移的隨機漫步模型，等同 ARIMA(0,1,0) with drift 的對數指數版本

重點是畫出兩種模型各自代表的「平均／期望成長路徑」，不是預測短期漲跌。

Dashboard 命名可以保留核心理念，例如 Market Growth Path，但畫面上必須清楚顯示目前使用的 canonical 資料集名稱、symbol、provider、source field、日期範圍與資料頻率。

## 輸入資料

Dashboard 必須能從 `data/canonical/` 選擇一份 canonical CSV 作為資料來源。使用者可以切換 canonical 資料集；每份資料集自己的頻率就是模型與圖表使用的頻率，dashboard 使用者不能另外把週資料切成月資料或把月資料切成週資料。

最低必要欄位：

- date：日期
- total_return_index：市場指數或市場代理指數，必須大於 0

建議欄位：

- source_value：原始來源值
- provider：資料來源，例如 alpha-vantage
- symbol：資料代號，例如 VT
- source_field：來源欄位，例如 adjusted_close

範例：

date,total_return_index,source_value,provider,symbol,source_field
2008-07-03,100,33.2599,alpha-vantage,VT,adjusted_close
2008-07-11,98.226994,32.6702,alpha-vantage,VT,adjusted_close

若資料集是 ETF adjusted close 或其他代理資料，dashboard 與 README 必須照資料集 metadata 如實顯示，例如：

「此資料集使用 VT adjusted close 重新基準化為 100，作為全球股票市場長期成長代理，不是官方 total return index。」

## 資料前處理

1. 日期由舊到新排序。
2. 移除重複日期；若同一日期出現多筆，保留最後一筆並在 diagnostics 記錄。
3. 拒絕小於或等於 0 的 `total_return_index` 值。
4. 不對市場指數做線性插值。
5. 偵測 canonical 資料集頻率，至少支援 `daily`、`weekly`、`monthly`、`irregular`：
   - 優先使用資料集 metadata 指定的頻率。
   - 若沒有 metadata，根據相鄰日期間隔的中位數判斷。
   - 即使資料看起來規律，所有年化計算仍使用實際 elapsed time。
6. 計算：

y_t = ln(index_t)

log_return_t = y_t - y_(t-1)

delta_year_t =
(date_t - date_(t-1)) / 365.2425 days

years_since_start =
(date_t - first_date) / 365.2425 days

7. 若資料有日期缺口，不補值；diagnostics 顯示最大間隔、異常間隔數量與資料頻率判定結果。

## 模型 A：對數線性確定性趨勢

模型：

ln(V_t) = a + b * years_since_start + epsilon_t

使用 OLS 估計 a 與 b。

歷史及未來趨勢值：

trend_t = exp(a + b * years_since_start)

因為時間單位直接使用年，所以隱含年化報酬為：

annualized_trend_return = exp(b) - 1

向未來延伸可設定年數，預設 30 年。未來日期的步距應沿用 canonical 資料集頻率：

- daily：用最近資料的交易日/日曆日規則生成，若無交易日 calendar，使用日曆日。
- weekly：每 7 天一筆。
- monthly：每月一筆，使用與資料集一致的月內日期規則；若無法判定，使用月末。
- irregular：使用月頻作為未來顯示頻率，但所有公式仍以 elapsed years 計算。

計算每一期相對趨勢偏離：

trend_deviation_t =
actual_index_t / trend_t - 1

目前偏離：

current_trend_deviation =
latest_actual_index / latest_trend_index - 1

此趨勢線不應強制通過最新實際點。

輸出：

- intercept a
- slope b
- annualized trend return
- fitted trend level
- current deviation
- R-squared
- regression residual series

R-squared 的 dashboard 白話解釋：

「這個數字表示歷史指數的對數水準，有多少比例可以被一條平滑的長期時間趨勢線解釋。越高代表歷史線比較貼近這條趨勢線；它不是預測準確率，也不代表未來一定會沿著這條線走。」

可選擇加入趨勢殘差帶：

- ±1 residual standard deviation
- ±2 residual standard deviations

在對數空間計算後再轉回指數尺度：

upper_k = exp(fitted_log_trend + k * residual_sd)
lower_k = exp(fitted_log_trend - k * residual_sd)

不要把這個殘差帶稱為隨機漫步的 prediction interval。

## 模型 B：帶漂移的隨機漫步

模型：

ln(V_t) = ln(V_(t-1)) + mu * delta_year_t + u_t

其中：

- mu 是每年的平均對數漂移。
- u_t 是該期無法由平均漂移解釋的衝擊。
- delta_year_t 是兩筆資料之間實際經過的年數。

drift 估計使用整段資料的 elapsed-time weighted log return：

mu =
sum(log_return_t) / sum(delta_year_t)

等價寫法：

mu =
[ln(V_T) - ln(V_0)] / [(date_T - date_0) / 365.2425]

這是把第一筆到最後一筆之間的總對數成長，除以實際經過年數。對 regular time series，它等同 drift method 使用的平均每期變化；對週資料、月資料或日期不完全規律的資料，它比直接平均每一期年化報酬更穩定。

另一種可驗證方式是使用 ARIMA(0,1,0) with drift；但必須確認函式庫對 drift 與時間頻率的定義，不可直接假設參數已年化。

未來 h 年的期望路徑：

forecast_log_index(T+h) =
ln(V_T) + mu * h

forecast_index(T+h) =
exp(ln(V_T) + mu * h)

隱含年化報酬：

annualized_drift_return =
exp(mu) - 1

這條預測線必須從最新實際指數 V_T 出發。

### Random walk forecast interval

若實作 forecast interval，使用對數空間的 annualized innovation variance，並假設：

Var(u_t) = sigma^2 * delta_year_t

先計算每期 drift residual：

u_t =
log_return_t - mu * delta_year_t

估計 annualized innovation variance：

sigma2 =
sum(u_t^2 / delta_year_t) / (n - 1)

sigma =
sqrt(sigma2)

其中 n 是 log return 筆數；`n - 1` 是因為 drift mu 已用同一段歷史資料估計。

未來 h 年的 log forecast standard deviation：

forecast_sd_log(h) =
sigma * sqrt(h + h^2 / sample_years)

其中：

sample_years =
sum(delta_year_t)

`h` 代表未來經過年數。`sigma * sqrt(h)` 是未來市場衝擊的不確定性；`sigma * sqrt(h^2 / sample_years)` 是 drift 估計本身的不確定性。若實作上想要較簡化的區間，可以提供只含市場衝擊的版本 `sigma * sqrt(h)`，但 dashboard 預設使用含 drift estimation uncertainty 的版本。

在對數空間建立區間，再轉回指數尺度：

lower_level(h) =
exp(forecast_log_index(T+h) - z * forecast_sd_log(h))

upper_level(h) =
exp(forecast_log_index(T+h) + z * forecast_sd_log(h))

z 值：

- 80% interval：1.2816
- 95% interval：1.9600

清楚標示它是 random walk forecast interval，不是模型 A 的趨勢殘差帶。

Dashboard 白話解釋：

「陰影區不是說市場會落在裡面，而是在這個簡化的隨機漫步模型下，用過去波動估出來的未來可能範圍。時間越遠，不確定性越大，所以區間會變寬。」

輸出：

- drift mu
- annualized drift return
- annualized innovation standard deviation
- forecast expected path
- 80% forecast interval
- 95% forecast interval

## 圖表

使用對數 Y 軸作為預設，並可切換普通 Y 軸。

主圖顯示：

1. 歷史實際指數
2. 模型 A 的歷史擬合線
3. 模型 A 的未來延伸線
4. 模型 B 從最新實際值出發的未來期望線
5. 模型 B 的 80% 與 95% forecast interval
6. 清楚標示歷史與未來的分界日期

不要將模型 B 在歷史區間畫成一條事後回歸線。它的主要視覺輸出是從最後觀測值開始的 forecast path。

第二張圖顯示：

trend_deviation_t =
actual / deterministic_trend - 1

以百分比顯示，0% 為歷史趨勢中心。

第三張圖顯示：

- 每期對數報酬
- 滾動年化報酬，可選 5 年、10 年、20 年

滾動年化報酬使用日期窗口，不使用固定 row count：

rolling_return(window_years, t) =
exp([ln(V_t) - ln(V_s)] / elapsed_years_s_to_t) - 1

其中 s 是 date_t 往前至少 window_years 年後，最接近該起點的可用觀測值。若資料歷史不足該窗口，該期 rolling return 為空值。

## Dashboard 指標

顯示：

- 最新指數值
- canonical dataset name
- provider
- symbol
- source field
- 資料起始與結束日期
- 模型 A 年化趨勢報酬
- 模型 B 年化漂移報酬
- 模型 B 年化波動率
- 最新值相對模型 A 趨勢的偏離率
- 樣本年數
- 使用的資料頻率
- 最大日期間隔與缺口診斷摘要

## 模型解釋文字

Dashboard 必須說明：

模型 A：
「假設歷史指數的對數水準，圍繞一條平滑的長期時間趨勢。這條線用整段歷史資料估計，所以不一定通過目前指數。」

模型 B：
「假設每段期間的對數報酬有一個長期平均漂移，而每次市場衝擊都會永久改變指數水準。未來期望路徑從最新實際指數開始。」

R-squared：
「表示歷史資料有多貼近模型 A 的平滑趨勢線；不是勝率、不是預測準確率，也不是市場一定會回到趨勢線的證據。」

Forecast interval：
「表示在模型 B 的簡化假設下，根據歷史波動估出的未來可能範圍。它會隨時間變寬，不代表最可能的實際路徑。」

不要寫：

- 市場一定會回歸模型 A
- 模型 A 是公允價值
- 高於趨勢必定代表高估
- 模型 B 的預測線是最可能出現的實際路徑

## 技術要求

請將以下工作拆成獨立模組：

- canonical dataset discovery
- data ingestion
- data validation
- frequency detection
- deterministic trend model
- random walk with drift model
- forecast generation
- rolling return calculation
- chart rendering
- model diagnostics

所有計算函式要有單元測試。

至少測試：

1. 固定 5% 複利序列，模型 A 應估出約 5%。
2. 固定 5% 複利序列，模型 B 應估出約 5%。
3. 將整段序列乘以常數後，模型 A 與模型 B 的年化成長率不應改變。
4. 最新價格突然增加 20% 時：
   - 模型 B 的 forecast path 第一個歷史分界點必須等於新的最新實際值。
   - 模型 B 的 forecast path 之後應從新的最新實際值乘上 `exp(mu * h)` 延伸。
   - 模型 A 的 latest fitted trend 可以改變，但不得被強制等於新的最新實際值。
5. 不規則日期仍應依實際 elapsed time 年化：
   - 模型 B 的 mu 必須等於 `sum(log_return) / sum(delta_year)`。
   - rolling annualized return 必須使用日期窗口與實際 elapsed years。
6. 不允許 `total_return_index <= 0`。
7. frequency detection 對目前 VT weekly canonical 資料應判定為 weekly。
8. forecast interval 在 h 較大時不得變窄；95% interval 必須寬於 80% interval。

最後請提供：

- 完整可執行程式
- README
- 資料格式說明
- 模型公式
- 測試
- 範例資料
- Dashboard 截圖或示範頁
