const { test, expect } = require('@playwright/test');

test.describe('Sistema Web - Teste do Botão', () => {
  test('deve carregar a página e alterar o estado ao clicar no botão', async ({ page }) => {
    // Acessar o servidor local
    await page.goto('http://localhost:3000');

    // Verificar título e estado inicial
    await expect(page.locator('#welcome-title')).toHaveText('Bem-vindo ao Sistema');
    const button = page.locator('#actionBtn');
    await expect(button).toHaveText('Clique aqui');

    // Clicar no botão
    await button.click();

    // Verificar se o texto do botão e da mensagem mudaram
    await expect(button).toHaveText('Clicado!');
    await expect(page.locator('#statusText')).toHaveText('O botão foi acionado com sucesso!');
  });
});
