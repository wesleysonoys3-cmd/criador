import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

void main() {
  runApp(const TatieApp());
}

class TatieApp extends StatelessWidget {
  const TatieApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TATIÊ — Ateliê & Cestas',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        primaryColor: const Color(0xFF521d28),
        scaffoldBackgroundColor: const Color(0xFFfbf5f3),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF521d28),
          primary: const Color(0xFF521d28),
          secondary: const Color(0xFFc5a059),
        ),
        fontFamily: 'Montserrat',
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {
  // Controle das animações flutuantes na tela (pétalas/corações)
  late Timer _petalTimer;
  final List<FloatingItem> _floatingItems = [];
  final Random _random = Random();

  @override
  void initState() {
    super.initState();
    // Gerar elementos flutuantes passando na tela periodicamente
    _petalTimer = Timer.periodic(const Duration(milliseconds: 900), (timer) {
      if (mounted) {
        setState(() {
          _floatingItems.add(FloatingItem(
            x: _random.nextDouble() * MediaQuery.of(context).size.width,
            symbol: ['❤', '🌸', '✨', '🌹', '💖', '⭐'][_random.nextInt(6)],
            size: _random.nextDouble() * 12 + 14,
            duration: Duration(seconds: _random.nextInt(7) + 6),
          ));
          if (_floatingItems.length > 25) {
            _floatingItems.removeAt(0);
          }
        });
      }
    });
  }

  @override
  void dispose() {
    _petalTimer.cancel();
    super.dispose();
  }

  Future<void> _launchWhatsApp(String message) async {
    final Uri url = Uri.parse('https://wa.me/5511999999999?text=${Uri.encodeComponent(message)}');
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
      throw Exception('Could not launch $url');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Animações de fundo passando na tela
          ..._floatingItems.map((item) => AnimatedFloatingWidget(item: item)),

          // Conteúdo Principal
          SingleChildScrollView(
            child: Column(
              children: [
                // Top Bar
                Container(
                  color: const Color(0xFF521d28),
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                  width: double.infinity,
                  child: const Text(
                    '✨ ATELIÊ & CESTAS • PRESENTES FEITOS PARA ENCANTAR ✨',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Color(0xFFf4e6e3),
                      fontSize: 11,
                      letterSpacing: 2,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),

                // Header / Navbar
                Container(
                  color: Colors.white.withOpacity(0.95),
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: const Color(0xFFc5a059), width: 2),
                              color: const Color(0xFFf4e6e3),
                            ),
                            child: const Center(
                              child: Text(
                                'T',
                                style: TextStyle(
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF521d28),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          const Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'TATIÊ',
                                style: TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 3,
                                  color: Color(0xFF521d28),
                                ),
                              ),
                              Text(
                                'ATELIÊ & CESTAS',
                                style: TextStyle(
                                  fontSize: 9,
                                  letterSpacing: 2,
                                  color: Color(0xFFc5a059),
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                      ElevatedButton.icon(
                        onPressed: () => _launchWhatsApp('Olá! Conheci o app da Tatiê e gostaria de encomendar uma cesta!'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF521d28),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                        ),
                        icon: const Icon(Icons.chat, size: 18, color: Colors.greenAccent),
                        label: const Text('WhatsApp', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ),

                // Hero Section
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 60, horizontal: 20),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFf4e6e3),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: const Color(0xFFc5a059).withOpacity(0.4)),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.favorite, size: 12, color: Color(0xFFc5a059)),
                            SizedBox(width: 6),
                            Text(
                              'PRESENTES FEITOS PARA ENCANTAR',
                              style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF521d28), letterSpacing: 1.5),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      const Text(
                        'Emocione quem você ama\ncom o carinho da Tatiê',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF521d28),
                          height: 1.2,
                        ),
                      ),
                      const SizedBox(height: 16),
                      const ConstrainedBox(
                        constraints: BoxConstraints(maxWidth: 600),
                        child: Text(
                          'Cestas artesanais exclusivas, arranjos florais delicados e mimos personalizados para aniversários, datas comemorativas e momentos inesquecíveis.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 14, color: Color(0xFF7a6467), height: 1.5),
                        ),
                      ),
                    ],
                  ),
                ),

                // Seção de Massagem de Números da Sorte
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16),
                  child: MatrixMassageWidget(),
                ),

                const SizedBox(height: 40),

                // Catálogo de Cestas
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: [
                      const Text(
                        'Catálogo de Cestas & Presentes',
                        style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Color(0xFF521d28)),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Escolha o presente perfeito e encomende direto pelo WhatsApp',
                        style: TextStyle(fontSize: 13, color: Color(0xFF7a6467)),
                      ),
                      const SizedBox(height: 30),
                      Wrap(
                        spacing: 20,
                        runSpacing: 20,
                        alignment: WrapAlignment.center,
                        children: [
                          ProductCard(
                            title: 'Cesta Amanhecer Encantado',
                            price: 'R$ 189,90',
                            description: 'Pães artesanais, frutas selecionadas, suco natural, frios nobres, iogurte e mini rosas.',
                            badge: 'Mais Vendida',
                            icon: Icons.breakfast_dining,
                            onOrder: () => _launchWhatsApp('Olá! Gostaria de encomendar a Cesta Amanhecer Encantado.'),
                          ),
                          ProductCard(
                            title: 'Cesta Amor & Vinho',
                            price: 'R$ 259,90',
                            description: 'Vinho tinto reservado, tábua de queijos finos, chocolates belgas, morangos e taças.',
                            badge: 'Romântica',
                            icon: Icons.wine_bar,
                            onOrder: () => _launchWhatsApp('Olá! Gostaria de encomendar a Cesta Amor & Vinho.'),
                          ),
                          ProductCard(
                            title: 'Box Flores & Chocolates',
                            price: 'R$ 149,90',
                            description: 'Caixa cartonada em formato de coração com mix de flores nobres e bombons artesanais.',
                            badge: 'Aniversário',
                            icon: Icons.card_giftcard,
                            onOrder: () => _launchWhatsApp('Olá! Gostaria de encomendar o Box Flores & Chocolates.'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 60),

                // Footer
                Container(
                  color: const Color(0xFF521d28),
                  padding: const EdgeInsets.all(30),
                  width: double.infinity,
                  child: Column(
                    children: [
                      const Text(
                        'TATIÊ ATELIÊ & CESTAS',
                        style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 2),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'São Paulo - SP • Contato: (11) 99999-9999',
                        style: TextStyle(color: Color(0xFFf4e6e3), fontSize: 12),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        '© 2026 Tatiê. Todos os direitos reservados.',
                        style: TextStyle(color: Color(0xFFc5a059), fontSize: 10),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Widget de Item Flutuante (Animação na Tela)
class FloatingItem {
  final double x;
  final String symbol;
  final double size;
  final Duration duration;

  FloatingItem({required this.x, required this.symbol, required this.size, required this.duration});
}

class AnimatedFloatingWidget extends StatefulWidget {
  final FloatingItem item;
  const AnimatedFloatingWidget({super.key, required this.item});

  @override
  State<AnimatedFloatingWidget> createState() => _AnimatedFloatingWidgetState();
}

class _AnimatedFloatingWidgetState extends State<AnimatedFloatingWidget> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(duration: widget.item.duration, vsync: this);
    _animation = Tween<double>(begin: -50, end: 900).animate(CurvedAnimation(parent: _controller, curve: Curves.linear));
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Positioned(
          left: widget.item.x,
          top: _animation.value,
          child: Opacity(
            opacity: 0.65,
            child: Text(
              widget.item.symbol,
              style: TextStyle(fontSize: widget.item.size),
            ),
          ),
        );
      },
    );
  }
}

// Widget da Massagem de Números da Sorte
class MatrixMassageWidget extends StatefulWidget {
  const MatrixMassageWidget({super.key});

  @override
  State<MatrixMassageWidget> createState() => _MatrixMassageWidgetState();
}

class _MatrixMassageWidgetState extends State<MatrixMassageWidget> {
  Timer? _timer;
  bool _isRunning = false;
  List<int> _currentNumbers = [];
  int _totalGenerated = 0;
  final Random _random = Random();

  void _toggleMassage() {
    setState(() {
      _isRunning = !_isRunning;
      if (_isRunning) {
        _timer = Timer.periodic(const Duration(milliseconds: 150), (timer) {
          setState(() {
            _currentNumbers = List.generate(12, (_) => _random.nextInt(60) + 1);
            _totalGenerated += 12;
          });
        });
      } else {
        _timer?.cancel();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFc5a059).withOpacity(0.5)),
        boxShadow: [
          BoxShadow(color: const Color(0xFFc5a059).withOpacity(0.2), blurRadius: 20, spreadRadius: 2)
        ],
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.spa, color: Color(0xFF521d28)),
                  SizedBox(width: 8),
                  Text(
                    'Massagem de Sorte Tatiê',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF521d28)),
                  ),
                ],
              ),
              ElevatedButton.icon(
                onPressed: _toggleMassage,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF521d28),
                  foregroundColor: Colors.white,
                ),
                icon: Icon(_isRunning ? Icons.pause : Icons.play_arrow),
                label: Text(_isRunning ? 'Pausar' : 'Iniciar'),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Container(
            height: 150,
            width: double.infinity,
            decoration: BoxDecoration(
              color: const Color(0xFF521d28).withOpacity(0.05),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFc5a059).withOpacity(0.3)),
            ),
            child: Center(
              child: _currentNumbers.isEmpty
                  ? const Text('Pressione Iniciar para relaxar e gerar números da sorte...',
                      style: TextStyle(color: Color(0xFF7a6467), fontStyle: FontStyle.italic))
                  : Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      alignment: WrapAlignment.center,
                      children: _currentNumbers.map((n) => Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFf4e6e3),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFc5a059)),
                        ),
                        child: Text(
                          n.toString().padLeft(2, '0'),
                          style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF521d28), fontSize: 16),
                        ),
                      )).toList(),
                    ),
            ),
          ),
          const SizedBox(height: 10),
          Text('Total gerados: $_totalGenerated', style: const TextStyle(fontSize: 11, color: Color(0xFF7a6467))),
        ],
      ),
    );
  }
}

// Card de Produto
class ProductCard extends StatelessWidget {
  final String title;
  final String price;
  final String description;
  final String badge;
  final IconData icon;
  final VoidCallback onOrder;

  const ProductCard({
    super.key,
    required this.title,
    required this.price,
    required this.description,
    required this.badge,
    required this.icon,
    required this.onOrder,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 320,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFc5a059).withOpacity(0.4)),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 10, offset: const Offset(0, 4))
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 160,
            decoration: const BoxDecoration(
              color: Color(0xFFf4e6e3),
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: Stack(
              children: [
                Positioned(
                  top: 12,
                  right: 12,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF521d28),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(badge, style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold)),
                  ),
                ),
                Center(
                  child: Icon(icon, size: 60, color: const Color(0xFFc5a059)),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF521d28))),
                const SizedBox(height: 8),
                Text(description, style: const TextStyle(fontSize: 12, color: Color(0xFF7a6467), height: 1.4)),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.between,
                  children: [
                    Text(price, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF521d28))),
                    ElevatedButton(
                      onPressed: onOrder,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF521d28),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                      ),
                      child: const Text('Encomendar', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
