import 'package:flutter/material.dart';
import 'models/wallet_model.dart';
import 'screens/home_screen.dart';

void main() {
  runApp(const CasinoApp());
}

class CasinoApp extends StatelessWidget {
  const CasinoApp({super.key});

  @override
  Widget build(BuildContext context) {
    final WalletModel wallet = WalletModel();

    return MaterialApp(
      title: 'Royal VIP Casino',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        primarySwatch: Colors.amber,
        scaffoldBackgroundColor: Colors.black,
      ),
      home: HomeScreen(wallet: wallet),
    );
  }
}
