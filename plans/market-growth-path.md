請建立一個全市場總報酬指數的時間序列分析與視覺化專案。

## 目標

使用同一份歷史全市場總報酬指數資料，建立並比較以下兩種長期成長模型：

1. Log-linear deterministic trend
   對數線性確定性趨勢模型

2. Random walk with drift
   帶漂移的隨機漫步模型，等同 ARIMA(0,1,0) with drift

重點是畫出兩種模型各自代表的「平均／期望成長路徑」，不是預測短期漲跌。

## 輸入資料

最低必要欄位：

- date：日期
- total_return_index：含股息再投資的總報酬指數，必須大於 0

選用欄位：

- cpi：消費者物價指數，用於建立實質總報酬指數

範例：

date,total_return_index,cpi
2000-01-31,100.00,169.3
2000-02-29,98.42,170.0

資料可能為日、週或月頻率。程式必須偵測或由設定指定資料頻率，並正確進行年化換算。

若有 CPI，建立：

real_index_t =
total_return_index_t / cpi_t

再重新基準化，使第一期等於 100。

Dashboard 必須允許切換：

- nominal total return
- real total return

## 資料前處理

1. 日期由舊到新排序。
2. 移除重複日期。
3. 拒絕小於或等於 0 的 index 值。
4. 將資料對齊至一致頻率，預設使用月末資料。
5. 不要對缺失的市場指數做線性插值。
6. 計算：

y_t = ln(index_t)

log_return_t = y_t - y_(t-1)

7. 時間變數不能只使用 row index；應使用實際經過時間，例如：

years_since_start =
(date - first_date) / 365.2425 days

這樣即使日期間隔不完全一致，也能正確估計年化趨勢。

## 模型 A：對數線性確定性趨勢

模型：

ln(V_t) = a + b * years_since_start + epsilon_t

使用 OLS 估計 a 與 b。

歷史及未來趨勢值：

trend_t = exp(a + b * years_since_start)

因為時間單位直接使用年，所以隱含年化報酬為：

annualized_trend_return = exp(b) - 1

向未來延伸可設定年數，預設 30 年。

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

為了支援不規則日期，優先使用按實際時間計算的年化對數報酬：

annualized_log_return_t =
[ln(V_t) - ln(V_(t-1))] / delta_year_t

估計：

mu =
mean annualized_log_return

另一種可驗證方式是使用 ARIMA(0,1,0) with drift；
但必須確認函式庫對 drift 與時間頻率的定義，不可直接假設參數已年化。

未來 h 年的期望路徑：

forecast_log_index(T+h) =
ln(V_T) + mu * h

forecast_index(T+h) =
exp(ln(V_T) + mu * h)

隱含年化報酬：

annualized_drift_return =
exp(mu) - 1

這條預測線必須從最新實際指數 V_T 出發。

若實作 prediction interval，使用模型估計的 innovation variance。
清楚標示它是 forecast interval，而不是確定性趨勢的殘差帶。

輸出：

- drift mu
- annualized drift return
- innovation standard deviation
- forecast expected path
- 80% prediction interval
- 95% prediction interval

## 圖表

使用對數 Y 軸作為預設，並可切換普通 Y 軸。

主圖顯示：

1. 歷史實際總報酬指數
2. 模型 A 的歷史擬合線
3. 模型 A 的未來延伸線
4. 模型 B 從最新實際值出發的未來期望線
5. 清楚標示歷史與未來的分界日期

不要將模型 B 在歷史區間畫成一條事後回歸線。
它的主要視覺輸出是從最後觀測值開始的 forecast path。

第二張圖顯示：

trend_deviation_t =
actual / deterministic_trend - 1

以百分比顯示，0% 為歷史趨勢中心。

第三張圖顯示：

- 每期對數報酬
- 滾動年化報酬，可選 5 年、10 年、20 年

## Dashboard 指標

顯示：

- 最新指數值
- 資料起始與結束日期
- 模型 A 年化趨勢報酬
- 模型 B 年化漂移報酬
- 最新值相對模型 A 趨勢的偏離率
- 樣本年數
- 名目／實質模式
- 使用的資料頻率

## 模型解釋文字

Dashboard 必須說明：

模型 A：
「假設對數指數圍繞一條固定的長期時間趨勢。線的位置由整段歷史資料估計，因此不一定通過目前指數。」

模型 B：
「假設每期報酬具有固定平均漂移，而歷史衝擊會永久改變指數水準。未來期望路徑從最新實際指數開始。」

不要寫：

- 市場一定會回歸模型 A
- 模型 A 是公允價值
- 高於趨勢必定代表高估
- 模型 B 的預測線是最可能出現的實際路徑

## 技術要求

請將以下工作拆成獨立模組：

- data ingestion
- data validation
- inflation adjustment
- resampling
- deterministic trend model
- random walk with drift model
- forecast generation
- chart rendering
- model diagnostics

所有計算函式要有單元測試。

至少測試：

1. 固定 5% 複利序列，模型 A 應估出約 5%。
2. 固定 5% 複利序列，模型 B 應估出約 5%。
3. 將整段序列乘以常數後，年化成長率不應改變。
4. 最新價格突然增加 20% 時：
   - 模型 A 趨勢線只會受到整體回歸的有限影響
   - 模型 B 預測線必須從新的最新值出發
5. 不規則日期仍應依實際 elapsed time 年化。
6. 使用 CPI 後，實質指數計算正確。
7. 不允許 index <= 0。

最後請提供：

- 完整可執行程式
- README
- 資料格式說明
- 模型公式
- 測試
- 範例資料
- Dashboard 截圖或示範頁