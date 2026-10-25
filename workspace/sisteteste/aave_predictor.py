"""
AAVE PREDICTOR - MVP

Objetivo:
- Buscar dados públicos de mercado
- Calcular indicadores técnicos
- Criar features
- Treinar um modelo probabilístico
- Estimar Alta / Lateral / Queda
- Fazer backtest temporal
- Salvar previsões

IMPORTANTE:
Este programa é experimental.
A probabilidade produzida pelo modelo NÃO é garantia de retorno.
"""

from __future__ import annotations

import os
import time
import json
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from sklearn.ensemble import RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

warnings.filterwarnings("ignore")


# ============================================================
# CONFIGURAÇÃO
# ============================================================

COIN_ID = "aave"

VS_CURRENCY = "usd"

DAYS = 365

HORIZON = 1

UP_THRESHOLD = 0.015
DOWN_THRESHOLD = -0.015

DATA_FILE = "aave_market_data.csv"
PREDICTIONS_FILE = "aave_predictions.csv"
MODEL_FILE = "aave_model.json"


# ============================================================
# UTILIDADES
# ============================================================

def log(message: str):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}")


# ============================================================
# COINGECKO
# ============================================================

def fetch_market_data(days: int = DAYS) -> pd.DataFrame:

    url = (
        f"https://api.coingecko.com/api/v3/coins/"
        f"{COIN_ID}/market_chart"
    )

    params = {
        "vs_currency": VS_CURRENCY,
        "days": days,
        "interval": "daily"
    }

    log("Baixando dados da AAVE...")

    response = requests.get(
        url,
        params=params,
        timeout=30
    )

    response.raise_for_status()

    data = response.json()

    prices = pd.DataFrame(
        data["prices"],
        columns=["timestamp", "close"]
    )

    volumes = pd.DataFrame(
        data["total_volumes"],
        columns=["timestamp", "volume"]
    )

    market_caps = pd.DataFrame(
        data["market_caps"],
        columns=["timestamp", "market_cap"]
    )

    df = prices.merge(
        volumes,
        on="timestamp",
        how="left"
    )

    df = df.merge(
        market_caps,
        on="timestamp",
        how="left"
    )

    df["date"] = pd.to_datetime(
        df["timestamp"],
        unit="ms",
        utc=True
    )

    df = df.sort_values("date")

    df = df.drop_duplicates(
        subset=["date"]
    )

    df = df.reset_index(drop=True)

    return df


# ============================================================
# INDICADORES
# ============================================================

def calculate_indicators(df: pd.DataFrame) -> pd.DataFrame:

    df = df.copy()

    # Retorno
    df["return_1d"] = df["close"].pct_change()

    df["return_3d"] = (
        df["close"].pct_change(3)
    )

    df["return_7d"] = (
        df["close"].pct_change(7)
    )

    # Médias móveis
    df["sma_7"] = (
        df["close"]
        .rolling(7)
        .mean()
    )

    df["sma_20"] = (
        df["close"]
        .rolling(20)
        .mean()
    )

    df["sma_50"] = (
        df["close"]
        .rolling(50)
        .mean()
    )

    # EMA
    df["ema_12"] = (
        df["close"]
        .ewm(span=12, adjust=False)
        .mean()
    )

    df["ema_26"] = (
        df["close"]
        .ewm(span=26, adjust=False)
        .mean()
    )

    # MACD
    df["macd"] = (
        df["ema_12"] -
        df["ema_26"]
    )

    df["macd_signal"] = (
        df["macd"]
        .ewm(span=9, adjust=False)
        .mean()
    )

    df["macd_hist"] = (
        df["macd"] -
        df["macd_signal"]
    )

    # RSI
    delta = df["close"].diff()

    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = (
        gain.rolling(14)
        .mean()
    )

    avg_loss = (
        loss.rolling(14)
        .mean()
    )

    rs = avg_gain / avg_loss.replace(
        0,
        np.nan
    )

    df["rsi"] = (
        100 -
        (100 / (1 + rs))
    )

    # Volatilidade
    df["volatility_7d"] = (
        df["return_1d"]
        .rolling(7)
        .std()
    )

    df["volatility_30d"] = (
        df["return_1d"]
        .rolling(30)
        .std()
    )

    # Volume
    df["volume_ma_7"] = (
        df["volume"]
        .rolling(7)
        .mean()
    )

    df["volume_ratio"] = (
        df["volume"] /
        df["volume_ma_7"]
    )

    # Distância das médias
    df["distance_sma20"] = (
        df["close"] /
        df["sma_20"] - 1
    )

    df["distance_sma50"] = (
        df["close"] /
        df["sma_50"] - 1
    )

    return df


# ============================================================
# TARGET
# ============================================================

def create_target(
    df: pd.DataFrame
) -> pd.DataFrame:

    df = df.copy()

    future_return = (
        df["close"]
        .shift(-HORIZON)
        /
        df["close"]
        - 1
    )

    """
    2 = ALTA
    1 = LATERAL
    0 = QUEDA
    """

    df["target"] = np.select(
        [
            future_return >= UP_THRESHOLD,
            future_return <= DOWN_THRESHOLD
        ],
        [
            2,
            0
        ],
        default=1
    )

    df["future_return"] = future_return

    return df


# ============================================================
# FEATURES
# ============================================================

FEATURES = [
    "return_1d",
    "return_3d",
    "return_7d",

    "sma_7",
    "sma_20",
    "sma_50",

    "ema_12",
    "ema_26",

    "macd",
    "macd_signal",
    "macd_hist",

    "rsi",

    "volatility_7d",
    "volatility_30d",

    "volume_ratio",

    "distance_sma20",
    "distance_sma50"
]


def prepare_dataset(
    df: pd.DataFrame
):

    dataset = df.copy()

    dataset = dataset.dropna(
        subset=FEATURES + ["target"]
    )

    X = dataset[FEATURES]

    y = dataset["target"]

    return dataset, X, y


# ============================================================
# MODELO
# ============================================================

def create_model():

    base_model = RandomForestClassifier(
        n_estimators=400,
        max_depth=8,
        min_samples_leaf=4,
        random_state=42,
        class_weight="balanced"
    )

    model = CalibratedClassifierCV(
        base_model,
        method="sigmoid",
        cv=3
    )

    return model


# ============================================================
# BACKTEST TEMPORAL
# ============================================================

def backtest(
    dataset: pd.DataFrame
):

    log("Iniciando backtest...")

    split = int(
        len(dataset) * 0.80
    )

    train = dataset.iloc[:split]
    test = dataset.iloc[split:]

    X_train = train[FEATURES]
    y_train = train["target"]

    X_test = test[FEATURES]
    y_test = test["target"]

    model = create_model()

    model.fit(
        X_train,
        y_train
    )

    predictions = model.predict(
        X_test
    )

    accuracy = accuracy_score(
        y_test,
        predictions
    )

    print()
    print("=" * 60)
    print("RESULTADO DO BACKTEST")
    print("=" * 60)

    print(
        f"Amostras treino : {len(train)}"
    )

    print(
        f"Amostras teste  : {len(test)}"
    )

    print(
        f"Accuracy        : {accuracy:.2%}"
    )

    print()
    print(
        classification_report(
            y_test,
            predictions,
            target_names=[
                "QUEDA",
                "LATERAL",
                "ALTA"
            ],
            zero_division=0
        )
    )

    print("Matriz de confusão:")

    print(
        confusion_matrix(
            y_test,
            predictions
        )
    )

    return model, test, predictions


# ============================================================
# PREVISÃO ATUAL
# ============================================================

def current_prediction(
    model,
    dataset: pd.DataFrame
):

    latest = dataset.iloc[-1]

    X = latest[
        FEATURES
    ].to_frame().T

    probabilities = (
        model.predict_proba(X)[0]
    )

    classes = model.classes_

    probability_map = {
        int(cls): float(prob)
        for cls, prob in zip(
            classes,
            probabilities
        )
    }

    down = probability_map.get(
        0,
        0
    )

    neutral = probability_map.get(
        1,
        0
    )

    up = probability_map.get(
        2,
        0
    )

    probabilities_array = np.array([
        down,
        neutral,
        up
    ])

    predicted_class = int(
        np.argmax(
            probabilities_array
        )
    )

    labels = {
        0: "QUEDA",
        1: "LATERAL",
        2: "ALTA"
    }

    result = {
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),

        "price": float(
            latest["close"]
        ),

        "prob_down": down,
        "prob_neutral": neutral,
        "prob_up": up,

        "prediction": labels[
            predicted_class
        ],

        "rsi": float(
            latest["rsi"]
        ),

        "volume_ratio": float(
            latest["volume_ratio"]
        )
    }

    return result


# ============================================================
# SALVAR PREVISÃO
# ============================================================

def save_prediction(
    prediction: dict
):

    file_exists = os.path.exists(
        PREDICTIONS_FILE
    )

    df = pd.DataFrame([
        prediction
    ])

    df.to_csv(
        PREDICTIONS_FILE,
        mode="a",
        header=not file_exists,
        index=False
    )


# ============================================================
# SALVAR CONFIGURAÇÃO DO MODELO
# ============================================================

def save_model_info():

    info = {
        "model": "RandomForest + Calibration",
        "asset": "AAVE",
        "horizon": HORIZON,
        "up_threshold": UP_THRESHOLD,
        "down_threshold": DOWN_THRESHOLD,
        "features": FEATURES,
        "created_at": datetime.now(
            timezone.utc
        ).isoformat()
    }

    with open(
        MODEL_FILE,
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            info,
            file,
            indent=2,
            ensure_ascii=False
        )


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("=" * 60)
    print("       AAVE PREDICTOR")
    print("=" * 60)
    print()

    # 1
    df = fetch_market_data()

    # 2
    df = calculate_indicators(df)

    # 3
    df = create_target(df)

    # 4
    df.to_csv(
        DATA_FILE,
        index=False
    )

    # 5
    dataset, X, y = (
        prepare_dataset(df)
    )

    # 6
    model, test, predictions = (
        backtest(dataset)
    )

    # 7
    result = current_prediction(
        model,
        dataset
    )

    # 8
    save_prediction(result)

    # 9
    save_model_info()

    print()
    print("=" * 60)
    print("PREVISÃO ATUAL DA AAVE")
    print("=" * 60)

    print(
        f"Preço: ${result['price']:.2f}"
    )

    print(
        f"Alta:     {result['prob_up']:.2%}"
    )

    print(
        f"Lateral:  {result['prob_neutral']:.2%}"
    )

    print(
        f"Queda:    {result['prob_down']:.2%}"
    )

    print()
    print(
        f"Predição: {result['prediction']}"
    )

    print(
        f"RSI: {result['rsi']:.2f}"
    )

    print(
        f"Volume relativo: "
        f"{result['volume_ratio']:.2f}x"
    )

    print()
    print("Arquivos gerados:")

    print(
        f"- {DATA_FILE}"
    )

    print(
        f"- {PREDICTIONS_FILE}"
    )

    print(
        f"- {MODEL_FILE}"
    )

    print()
    print("Sistema concluído.")


if __name__ == "__main__":
    main()
