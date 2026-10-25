"""
AAVE LIVE AGENT - Monitoramento Contínuo ao Vivo (a cada 15 segundos)
"""

import time
import sys
import requests
from datetime import datetime, timezone

COIN_ID = "aave"
VS_CURRENCY = "usd"
INTERVAL_SEC = 15

def log(message: str):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}")

def analisar_ao_vivo():
    try:
        url = f"https://api.coingecko.com/api/v3/simple/price"
        params = {
            "ids": COIN_ID,
            "vs_currencies": VS_CURRENCY,
            "include_24hr_change": "true",
            "include_24hr_vol": "true"
        }
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if COIN_ID in data:
            coin = data[COIN_ID]
            price = coin.get("usd", 0)
            change_24h = coin.get("usd_24h_change", 0)

            tendencia = "LATERAL"
            if change_24h > 1.0:
                tendencia = "ALTA (VAI SUBIR 🚀)"
            elif change_24h < -1.0:
                tendencia = "QUEDA (VAI DESCER 📉)"

            volatilidade_estimada = abs(change_24h) * 0.4

            print("\n" + "="*65)
            log(f"🟢 [AGENTE AO VIVO - STREAMING] Ativo: AAVE")
            print(f"   💵 Preço Atual        : ${price:.2f} USD")
            print(f"   📊 Variação 24h       : {change_24h:+.2f}%")
            print(f"   ⚡ Volatilidade Est.  : {volatilidade_estimada:.2f}%")
            print(f"   🔮 Predição de Tendência: {tendencia}")
            print("="*65 + "\n")
        else:
            log("⚠️ Resposta da API sem dados do ativo.")
    except Exception as e:
        log(f"❌ Erro ao consultar API ao vivo: {e}")

def main():
    print("=" * 65)
    print("🤖 AGENTE AUTÔNOMO AO VIVO DA AAVE INICIALIZADO")
    print(f"⏳ Coletando dados de mercado a cada {INTERVAL_SEC} segundos...")
    print("=" * 65)

    try:
        while True:
            analisar_ao_vivo()
            sys.stdout.flush()
            time.sleep(INTERVAL_SEC)
    except KeyboardInterrupt:
        print("\n🛑 Agente ao vivo encerrado pelo usuário.")

if __name__ == "__main__":
    main()
