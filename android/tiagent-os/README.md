# TIAgente OS para Android

Aplicativo Android nativo que abre o TIAgente OS hospedado em:

`https://criador.onrender.com/tiagent-os/`

O navegador do TIAgente OS encaminha endereços externos para uma WebView nativa dentro do próprio app. A navegação e os downloads aceitam somente HTTPS; pop-ups e abertura em navegadores externos ficam bloqueados.

## Instalar APKs

Downloads iniciados pelo navegador mostram uma confirmação antes de baixar. Para arquivos `.apk`, o app pede confirmação novamente e entrega o arquivo ao instalador oficial do Android. O usuário ainda precisa autorizar “Instalar apps desconhecidos” para esta origem e confirmar a instalação no Android. Não há instalação silenciosa.

Aplicativos instalados são aplicativos Android normais e aparecem no launcher do aparelho; eles não são executados dentro das janelas do TIAgente OS. Instale APKs apenas de fontes confiáveis.

## Requisitos

- Android 8.0 (API 26) ou superior.
- Conexão com a internet para carregar o TIAgente OS.
- Componente Android System WebView atualizado, para melhor compatibilidade com sites atuais.

Este APK não funciona em iPhone ou iPad. Alguns sites podem limitar acesso em WebViews ou exigir recursos recentes do Android System WebView.

## Compilar

Com Android SDK instalado:

```sh
./gradlew assembleDebug
```

O APK de teste é gerado em:

`app/build/outputs/apk/debug/app-debug.apk`

O APK Debug é assinado com a chave de desenvolvimento local do Gradle e serve para testes/sideload. Para distribuição pública ou Play Store, configure uma chave de assinatura própria e revise as políticas de distribuição de instaladores de pacotes.
