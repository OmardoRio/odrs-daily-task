# ODR's Daily Task

Widget desktop (Electron) com um checklist de tarefas diárias, visual "vidro"
semi-transparente com bordas arredondadas e o mascote da Omar do Rio.

> Este repositório é público e serve só para distribuir o instalador (link de
> download universal, sem precisar de acesso a nenhum outro sistema interno).
> **[Baixar a versão mais recente →](https://github.com/omardorio/odrs-daily-task/releases/latest)**

## Rodando em desenvolvimento

Pré-requisito: Node.js 18+ instalado.

```bash
npm install
npm start
```

O widget abre ancorado no canto superior direito da tela, sempre por cima das
outras janelas. Pode ser arrastado clicando em qualquer área vazia dele (o
cursor vira uma "mãozinha de mover" para indicar isso) e solto em qualquer
canto da tela — a posição escolhida fica salva e é lembrada na próxima vez que
o app abrir. As bordas também podem ser arrastadas para redimensionar (deixar
mais largo ou mais alto); uma vez redimensionado manualmente, o widget para de
ajustar a altura sozinho conforme tarefas são adicionadas (a lista passa a
rolar internamente dentro do tamanho escolhido).

O botão "─" minimiza para a barra de tarefas do Windows (ou Dock, no Mac) como
qualquer outro programa — clique no ícone dele lá para reabrir. Ele também
continua disponível pelo ícone na bandeja do sistema (perto do relógio),
clicando ou pelo menu "Mostrar / Ocultar". O botão "✕" oculta o widget por
completo (some da barra de tarefas e da bandeja de tarefas abertas) — para
fechar de verdade, use "Sair" no menu do ícone da bandeja.

## Como funciona o checklist

- As tarefas são digitadas no campo "Adicionar tarefa..." e aparecem como
  `[ ] nome da tarefa`.
- Clicar na caixa desenha o "check" e risca o texto (tarefa concluída).
- A lista é referente sempre ao dia de **hoje**: as tarefas ficam salvas em
  `tasks.json` dentro da pasta de dados do usuário do app, e a cada virada de
  dia (meia-noite) a lista é automaticamente zerada para o novo dia — não
  carrega tarefas de dias anteriores nem mostra nada de dias futuros.
- A altura do widget se ajusta sozinha conforme as tarefas são adicionadas ou
  removidas (ele cresce para baixo a partir do canto onde foi ancorado), até
  um limite de 8 tarefas visíveis; a partir daí a lista rola internamente em
  vez de continuar crescendo — isso só vale enquanto o tamanho não tiver sido
  ajustado manualmente (ver seção acima).
- Passar o mouse sobre uma tarefa revela um ícone de lápis (editar o texto) e
  um "x" (remover). Clicar no lápis transforma o texto num campo editável —
  Enter salva, Esc cancela.
- Também aparece um "⋮⋮" à esquerda: arraste por ele para reordenar as
  tarefas (a ordem é a prioridade). Funciona inclusive com tarefas importadas
  do Google Agenda, e a ordem escolhida é respeitada nas próximas
  sincronizações.
- Clicar com o botão direito numa área vazia do widget (fora de uma tarefa ou
  botão) abre um menu com **"Resetar tarefas"** (apaga todas as tarefas do dia
  — pede confirmação antes, pois não pode ser desfeito) e **"Verificar
  atualizações"**.
- Tudo é salvo automaticamente a cada ação (gravação atômica em disco), e o
  texto ainda não enviado no campo "Adicionar tarefa..." também é salvo
  enquanto você digita — uma queda de energia ou travamento não perde nada.

## Mascote

O mascote oficial (`assets/Pin.png`) é a fonte usada para gerar
automaticamente:

- `assets/mascot.png` — imagem exibida no cabeçalho do widget.
- `build/icon.png` — ícone do aplicativo/instalador (o electron-builder gera o
  `.ico` do Windows e o `.icns` do Mac a partir dele).
- `assets/tray-icon.png` e `assets/tray-icon@2x.png` — ícone da bandeja do
  sistema (recortados só na parte de cima do personagem, sem as pernas, pra
  ficar legível em tamanho pequeno).

## Baixando o executável e atualizações automáticas

O link de download público e sempre atualizado é a página de Releases deste
repositório:

**https://github.com/omardorio/odrs-daily-task/releases/latest**

O app já instalado verifica sozinho a cada 2 horas (e também ao abrir) se há
uma versão mais nova publicada aqui; se houver, baixa e se atualiza sozinho —
não precisa reinstalar manualmente. Dá pra forçar essa checagem na hora pelo
menu da bandeja ou pelo menu de botão direito, em "Verificar atualizações".

Também é possível gerar localmente (sem publicar):

```bash
npm run build:win   # gera instalador .exe (NSIS) em dist/
npm run build:mac   # gera .dmg e .zip em dist/
npm run build:all   # os dois
```

**Sobre a atualização automática no Mac:** sem um certificado de
desenvolvedor Apple (pago), o macOS pode bloquear a instalação automática do
update por não reconhecer o app como assinado — nesse caso o usuário Mac
precisaria baixar e reinstalar manualmente a partir da Release. No Windows
isso não costuma ser um problema.

## Integração com Google Agenda

O widget pode importar automaticamente os eventos de **hoje** (só hoje — nada
de ontem ou amanhã) da sua Google Agenda, mostrados na lista com um ícone de
calendário e opacidade mais clara, sem opção de editar/apagar (eles são
geridos pelo Google, não por aqui; reaparecem sozinhos na próxima
sincronização). Marcar como concluído funciona normalmente, só que é um
controle local — não sincroniza de volta para o Google.

### Configuração (uma vez por computador)

1. Crie um projeto no [Google Cloud Console](https://console.cloud.google.com/).
2. Ative a "Google Calendar API" para esse projeto.
3. Configure a tela de consentimento OAuth (modo "Externo" + seu e-mail como
   usuário de teste já é suficiente para uso pessoal/interno, sem precisar de
   aprovação do Google).
4. Crie uma credencial OAuth do tipo **"App para Desktop"** e copie o
   `client_id` e o `client_secret` gerados.
5. Crie um arquivo `google-credentials.json` com este conteúdo:
   ```json
   { "client_id": "SEU_CLIENT_ID", "client_secret": "SEU_CLIENT_SECRET" }
   ```
6. Salve esse arquivo na pasta de dados do app (crie a pasta se ela ainda não
   existir, pois só aparece após abrir o app pelo menos uma vez):
   - Windows: `%APPDATA%\odrs-daily-task\google-credentials.json`
   - Mac: `~/Library/Application Support/odrs-daily-task/google-credentials.json`
7. Abra o menu do ícone da bandeja e clique em **"Conectar Google Agenda..."**
   — isso abre o navegador para você autorizar o acesso (somente leitura).
   Depois disso a sincronização acontece sozinha a cada 10 minutos (e também
   pode ser forçada a qualquer momento pelo mesmo menu, que passa a mostrar
   "Sincronizar Google Agenda agora").

As credenciais e o token ficam só nessa pasta local — nunca vão para o
GitHub nem para o instalador.

Só uma conta Google fica conectada por vez em cada computador. Pra trocar de
conta, use **"Desconectar Google Agenda"** no mesmo menu (isso também some com
as tarefas importadas) e depois "Conectar Google Agenda..." de novo,
escolhendo a outra conta na tela do Google.
