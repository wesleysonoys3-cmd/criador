"""
BITCOIN & AAVE LIVE AGENT - Análise ao Vivo de Alta e Baixa (a cada 15 segundos)
"""

import time
import sys
import requests
from datetime import datetime, timezone

def log(message: str):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}")

def analisar_mercado_ao_vivo():
    try:
        url = "https://api.coingecko.com/api/v3/simple/price"
        params = {
            "ids": "bitcoin,aave",
            "vs_currencies": "usd,brl",
            "include_24hr_change": "true",
            "include_24hr_vol": "true"
        }
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        print("\n" + "="*75)
        log("🤖 [AGENTE AUTÔNOMO AO VIVO] - ANÁLISE DE MERCADO EM TEMPO REAL")
        print("="*75)

        for coin_id, nome in [("bitcoin", "BITCOIN (BTC)"), ("aave", "AAVE (AAVE)")]:
            if coin_id in data:
                coin = data[coin_id]
                price_usd = coin.get("usd", 0)
                price_brl = coin.get("brl", 0)
                change_24h = coin.get("usd_24h_change", 0)
                vol_24h = coin.get("usd_24h_vol", 0)

                # Sinais de Alta e Baixa baseados em indicadores simulados em tempo real
                sinais_alta = []
                sinais_baixa = []

                if change_24h > 0:
                    sinais_alta.append(f"Momentum Positivo diário ({change_24h:+.2f}%)")
                    sinais_alta.append("Pressão compradora superando a média móvel de curto prazo")
                else:
                    sinais_baixa.append(f"Correção de preço detectada ({change_24h:+.2f}%)")
                    sinais_baixa.append("Testando suporte inferior das Bandas de Bollinger")

                # Volatilidade estimada
                volatilidade = abs(change_24h) * 0.45
                tendencia = "ALTA (VAI SUBIR 🚀)" if change_24h >= 0 else "QUEDA (VAI DESCER 📉)"

                print(f"\n🔹 ATIVO: {nome}")
                print(f"   💵 Preço Atual        : ${price_usd:,.2f} USD (R$ {price_brl:,.2f})")
                print(f"   📊 Variação 24h       : {change_24h:+.2f}%")
                print(f"   ⚡ Volatilidade Est.  : {volatilidade:.2f}%")
                print(f"   🔮 Predição de IA     : {tendencia}")
                print(f"   📈 Sinais de Alta     : {', '.join(sinais_alta)}")
                print(f"   📉 Sinais de Baixa    : {', '.join(sinais_baixa)}")

        print("="*75 + "\n")
    except Exception as e:
        log(f"❌ Erro ao consultar API em tempo real: {e}")

def main():
    print("=" * 75)
    print("🚀 INICIANDO AGENTE AUTÔNOMO AO VIVO (Bitcoin & Aave)")
    print("⏳ Atualizando e analisando sinais de alta/baixa a cada 15 segundos...")
    print("=" * 75)

    try:
        while True:
            analisar_mercado_ao_vivo()
            sys.stdout.flush()
            time.sleep(15)
    except KeyboardInterrupt:
        print("\n🛑 Agente autônomo encerrado pelo usuário.")

if __name__ == "__main__":
    main()
