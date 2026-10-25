import 'package:flutter/material.dart';
import '../models/wallet_model.dart';
import 'slot_machine_screen.dart';
import 'roulette_screen.dart';
import 'blackjack_screen.dart';
import 'wallet_screen.dart';

class HomeScreen extends StatelessWidget {
  final WalletModel wallet;

  const HomeScreen({Key? key, required this.wallet}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('🎰 Royal VIP Casino 🎲'),
        backgroundColor: Colors.black,
        actions: [
          ListenableBuilder(
            listenable: wallet,
            builder: (context, _) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0),
                  child: InkWell(
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => WalletScreen(wallet: wallet)),
                      );
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.amber[800],
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        '💰 R\$ ${wallet.balance.toStringAsFixed(2)}',
                        style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.black),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [Colors.black, Colors.grey[900]!, Colors.purple[900]!],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Escolha seu Jogo',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.amberAccent),
              ),
              const SizedBox(height: 20),
              Expanded(
                child: GridView.count(
                  crossAxisCount: 2,
                  crossAxisSpacing: 16,
                  mainAxisSpacing: 16,
                  children: [
                    GameCard(
                      title: 'Caça-Níquel',
                      icon: '🎰',
                      color: Colors.amber[800]!,
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => SlotMachineScreen(wallet: wallet)),
                        );
                      },
                    ),
                    GameCard(
                      title: 'Roleta',
                      icon: '🎯',
                      color: Colors.red[800]!,
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => RouletteScreen(wallet: wallet)),
                        );
                      },
                    ),
                    GameCard(
                      title: 'Blackjack (21)',
                      icon: '🃏',
                      color: Colors.green[800]!,
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => BlackjackScreen(wallet: wallet)),
                        );
                      },
                    ),
                    GameCard(
                      title: 'Caixa / Recarga',
                      icon: '💰',
                      color: Colors.blue[800]!,
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => WalletScreen(wallet: wallet)),
                        );
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class GameCard extends StatelessWidget {
  final String title;
  final String icon;
  final Color color;
  final VoidCallback onTap;

  const GameCard({
    Key? key,
    required this.title,
    required this.icon,
    required this.color,
    required this.onTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(color: color.withOpacity(0.5), blurRadius: 10, spreadRadius: 2),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(icon, style: const TextStyle(fontSize: 50)),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}
