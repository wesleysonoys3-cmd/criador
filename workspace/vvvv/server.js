const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Rota principal: Página estilo YouTube
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>YouTube - Página Inicial</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-zinc-900 text-white font-sans antialiased min-h-screen">
        <!-- Header -->
        <header class="flex items-center justify-between px-4 h-14 bg-zinc-900 sticky top-0 z-50 border-b border-zinc-800">
            <div class="flex items-center gap-4">
                <button class="p-2 hover:bg-zinc-800 rounded-full text-zinc-300">
                    <i class="fa-solid fa-bars text-lg"></i>
                </button>
                <div class="flex items-center gap-1 cursor-pointer">
                    <i class="fa-brands fa-youtube text-red-600 text-3xl"></i>
                    <span class="font-bold text-xl tracking-tighter">YouTube</span>
                </div>
            </div>
            
            <div class="flex items-center flex-1 max-w-xl mx-4">
                <div class="flex flex-1 items-center bg-zinc-950 border border-zinc-700 rounded-l-full px-4 py-2 focus-within:border-blue-500">
                    <input type="text" placeholder="Pesquisar" class="w-full bg-transparent outline-none text-sm placeholder-zinc-500">
                </div>
                <button class="bg-zinc-800 border border-l-0 border-zinc-700 px-6 py-2 rounded-r-full hover:bg-zinc-700 text-zinc-300">
                    <i class="fa-solid fa-magnifying-glass"></i>
                </button>
                <button class="ml-4 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-300">
                    <i class="fa-solid fa-microphone"></i>
                </button>
            </div>
            
            <div class="flex items-center gap-3">
                <button class="p-2 hover:bg-zinc-800 rounded-full text-zinc-300"><i class="fa-solid fa-video text-lg"></i></button>
                <button class="p-2 hover:bg-zinc-800 rounded-full text-zinc-300"><i class="fa-solid fa-bell text-lg"></i></button>
                <div class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center font-bold text-sm">TS</div>
            </div>
        </header>

        <div class="flex">
            <!-- Sidebar -->
            <aside class="w-64 p-3 hidden md:block sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
                <div class="space-y-1">
                    <a href="#" class="flex items-center gap-6 px-3 py-2.5 rounded-xl bg-zinc-800 font-medium text-sm"><i class="fa-solid fa-house text-lg w-6"></i> Início</a>
                    <a href="#" class="flex items-center gap-6 px-3 py-2.5 rounded-xl hover:bg-zinc-800 font-medium text-sm text-zinc-300"><i class="fa-solid fa-bolt text-lg w-6"></i> Shorts</a>
                    <a href="#" class="flex items-center gap-6 px-3 py-2.5 rounded-xl hover:bg-zinc-800 font-medium text-sm text-zinc-300"><i class="fa-solid fa-clapperboard text-lg w-6"></i> Inscrições</a>
                </div>
                <hr class="border-zinc-800 my-3">
                <div class="space-y-1">
                    <div class="px-3 py-1 font-bold text-sm text-zinc-400">Você</div>
                    <a href="#" class="flex items-center gap-6 px-3 py-2.5 rounded-xl hover:bg-zinc-800 text-sm text-zinc-300"><i class="fa-solid fa-user-clock text-lg w-6"></i> Histórico</a>
                    <a href="#" class="flex items-center gap-6 px-3 py-2.5 rounded-xl hover:bg-zinc-800 text-sm text-zinc-300"><i class="fa-solid fa-play text-lg w-6"></i> Seus vídeos</a>
                    <a href="#" class="flex items-center gap-6 px-3 py-2.5 rounded-xl hover:bg-zinc-800 text-sm text-zinc-300"><i class="fa-solid fa-clock text-lg w-6"></i> Assistir mais tarde</a>
                    <a href="#" class="flex items-center gap-6 px-3 py-2.5 rounded-xl hover:bg-zinc-800 text-sm text-zinc-300"><i class="fa-solid fa-thumbs-up text-lg w-6"></i> Vídeos marcados</a>
                </div>
            </aside>

            <!-- Main Content -->
            <main class="flex-1 p-6">
                <!-- Tags de navegação -->
                <div class="flex gap-3 overflow-x-auto pb-4 mb-6 text-sm">
                    <button class="bg-white text-black px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">Tudo</button>
                    <button class="bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">Música</button>
                    <button class="bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">Jogos</button>
                    <button class="bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">Ao vivo</button>
                    <button class="bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">Programação</button>
                    <button class="bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">Podcasts</button>
                    <button class="bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">Inteligência Artificial</button>
                </div>

                <!-- Grid de Vídeos -->
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" id="video-grid">
                    <!-- Vídeo 1 -->
                    <div class="flex flex-col gap-2 cursor-pointer group" onclick="alert('Reproduzindo vídeo!')">
                        <div class="bg-zinc-800 rounded-xl aspect-video relative overflow-hidden flex items-center justify-center">
                            <i class="fa-solid fa-play text-4xl text-red-600 group-hover:scale-110 transition-transform"></i>
                            <span class="absolute bottom-2 right-2 bg-black/80 text-xs px-1.5 py-0.5 rounded font-semibold">14:22</span>
                        </div>
                        <div class="flex gap-3 mt-1">
                            <div class="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center font-bold text-sm shrink-0">DT</div>
                            <div>
                                <h3 class="font-semibold text-sm line-clamp-2 leading-tight group-hover:text-blue-400">Criando um Clone do YouTube completo com Node.js e Tailwind CSS</h3>
                                <p class="text-zinc-400 text-xs mt-1">DevTV Brasil</p>
                                <p class="text-zinc-400 text-xs">45 mil visualizações • há 2 dias</p>
                            </div>
                        </div>
                    </div>

                    <!-- Vídeo 2 -->
                    <div class="flex flex-col gap-2 cursor-pointer group" onclick="alert('Reproduzindo vídeo!')">
                        <div class="bg-zinc-800 rounded-xl aspect-video relative overflow-hidden flex items-center justify-center">
                            <i class="fa-solid fa-play text-4xl text-red-600 group-hover:scale-110 transition-transform"></i>
                            <span class="absolute bottom-2 right-2 bg-black/80 text-xs px-1.5 py-0.5 rounded font-semibold">28:05</span>
                        </div>
                        <div class="flex gap-3 mt-1">
                            <div class="w-9 h-9 rounded-full bg-green-600 flex items-center justify-center font-bold text-sm shrink-0">CS</div>
                            <div>
                                <h3 class="font-semibold text-sm line-clamp-2 leading-tight group-hover:text-blue-400">Arquitetura de Software Moderna e Agentes Autônomos em Ação</h3>
                                <p class="text-zinc-400 text-xs mt-1">CodeMaster</p>
                                <p class="text-zinc-400 text-xs">12 mil visualizações • há 5 dias</p>
                            </div>
                        </div>
                    </div>

                    <!-- Vídeo 3 -->
                    <div class="flex flex-col gap-2 cursor-pointer group" onclick="alert('Reproduzindo vídeo!')">
                        <div class="bg-zinc-800 rounded-xl aspect-video relative overflow-hidden flex items-center justify-center">
                            <i class="fa-solid fa-play text-4xl text-red-600 group-hover:scale-110 transition-transform"></i>
                            <span class="absolute bottom-2 right-2 bg-black/80 text-xs px-1.5 py-0.5 rounded font-semibold">10:15</span>
                        </div>
                        <div class="flex gap-3 mt-1">
                            <div class="w-9 h-9 rounded-full bg-purple-600 flex items-center justify-center font-bold text-sm shrink-0">JS</div>
                            <div>
                                <h3 class="font-semibold text-sm line-clamp-2 leading-tight group-hover:text-blue-400">JavaScript Avançado: Event Loop e Assincronicidade Explicados</h3>
                                <p class="text-zinc-400 text-xs mt-1">JS Experts</p>
                                <p class="text-zinc-400 text-xs">120 mil visualizações • há 1 semana</p>
                            </div>
                        </div>
                    </div>

                    <!-- Vídeo 4 -->
                    <div class="flex flex-col gap-2 cursor-pointer group" onclick="alert('Reproduzindo vídeo!')">
                        <div class="bg-zinc-800 rounded-xl aspect-video relative overflow-hidden flex items-center justify-center">
                            <i class="fa-solid fa-play text-4xl text-red-600 group-hover:scale-110 transition-transform"></i>
                            <span class="absolute bottom-2 right-2 bg-black/80 text-xs px-1.5 py-0.5 rounded font-semibold">58:30</span>
                        </div>
                        <div class="flex gap-3 mt-1">
                            <div class="w-9 h-9 rounded-full bg-amber-600 flex items-center justify-center font-bold text-sm shrink-0">LP</div>
                            <div>
                                <h3 class="font-semibold text-sm line-clamp-2 leading-tight group-hover:text-blue-400">Podcast Ao Vivo: O Futuro da Inteligência Artificial Generativa</h3>
                                <p class="text-zinc-400 text-xs mt-1">TechCast</p>
                                <p class="text-zinc-400 text-xs">8.4 mil visualizações • transmitido há 3 horas</p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    </body>
    </html>
  `);
});

// Endpoint de API de teste
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API do YouTube em funcionamento perfeitamente!' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

module.exports = app;
