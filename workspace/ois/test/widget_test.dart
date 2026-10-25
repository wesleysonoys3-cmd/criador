import 'package:flutter_test/flutter_test.dart';
import 'package:casino_app/main.dart';

void main() {
  testWidgets('Casino app smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const CasinoApp());

    // Verify that casino lobby title is present.
    expect(find.text('🎰 Royal VIP Casino 🎲'), findsOneWidget);
    expect(find.text('Caça-Níquel'), findsOneWidget);
    expect(find.text('Roleta'), findsOneWidget);
    expect(find.text('Blackjack (21)'), findsOneWidget);
  });
}
