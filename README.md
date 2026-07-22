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

Por padrão, tanto o botão "─" quanto o "✕" fazem a mesma coisa: minimizam para
a barra de tarefas do Windows (ou Dock, no Mac) como qualquer outro programa —
clique no ícone dele lá para reabrir. O widget também continua disponível pelo
ícone na bandeja do sistema (perto do relógio), clicando ou pelo menu "Mostrar
/ Ocultar". Para fechar de verdade (sair do app), use "Sair" no menu do ícone
da bandeja.

Por padrão o widget também abre sozinho ao ligar o computador, junto com os
outros programas de inicialização — não precisa abrir manualmente toda vez.
Para desligar isso, desmarque "Abrir automaticamente ao ligar o computador"
no mesmo menu da bandeja.

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
- O texto de qualquer tarefa (inclusive as importadas do Google Agenda) pode
  ser selecionado arrastando o mouse por cima, igual em qualquer outro texto
  — daí é só copiar com Ctrl+C (ou Cmd+C no Mac) ou pelo menu que aparece ao
  clicar com o botão direito em cima da seleção.
- Também aparece um "⋮⋮" à esquerda: arraste por ele para reordenar as
  tarefas (a ordem é a prioridade). Funciona inclusive com tarefas importadas
  do Google Agenda, e a ordem escolhida é respeitada nas próximas
  sincronizações.
- Clicar com o botão direito numa área vazia do widget (fora de uma tarefa ou
  botão) abre um menu com **"Resetar tarefas"** (apaga todas as tarefas do dia
  — pede confirmação antes, pois não pode ser desfeito), **"Opacidade do
  widget"** (submenu de 20% a 90%, em passos de 10% — quanto maior, mais
  clara/sólida a caixa fica; 50% é o padrão) e **"Verificar atualizações"**.
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

**Sobre instalar no Windows:** ao abrir o instalador baixado, o Windows
SmartScreen normalmente mostra um aviso ("O Windows protegeu seu PC") antes de
deixar rodar — isso acontece com qualquer programa novo que ainda não tem um
certificado de assinatura de código pago (não existe uma opção gratuita que
elimine esse aviso). O arquivo não tem nada de errado; para continuar, uma
única vez por computador:
1. No aviso, clique em **"Mais informações"**.
2. Clique em **"Executar assim mesmo"**.

Depois desse primeiro "Executar assim mesmo", as próximas instalações e
atualizações automáticas passam a funcionar sem mostrar o aviso de novo.

**Sobre instalar no Mac:** este app não tem um certificado de desenvolvedor
Apple (o programa pago da Apple, ~US$99/ano) — por isso o instalador leva uma
assinatura "ad-hoc" (gratuita, gerada automaticamente no build, sem precisar
de conta Apple nenhuma). Isso é o mínimo necessário pro app conseguir *abrir*
em Macs com chip Apple Silicon (M1/M2/M3/M4): sem nenhuma assinatura, o
macOS recusa rodar o app e mostra "**'ODR's Daily Task' está danificado e não
pode ser aberto**" — uma mensagem enganosa, já que o arquivo não está
corrompido de verdade, só sem assinatura.

Mesmo assinado ad-hoc, a primeira abertura em qualquer Mac ainda mostra o
aviso normal do Gatekeeper (o app continua de um "desenvolvedor não
identificado" aos olhos da Apple, já que isso exigiria o certificado pago).
Para abrir mesmo assim, uma única vez por computador:
1. Tente abrir o app normalmente — ele vai recusar e mostrar o aviso de
   bloqueio.
2. Vá em **Ajustes do Sistema → Privacidade e Segurança**, role até o fim da
   página e clique em **"Abrir Mesmo Assim"** ao lado do aviso sobre o app
   bloqueado, confirmando mais uma vez na janela que aparece.
   (Em versões mais antigas do macOS, clicar com o botão direito no app e
   escolher "Abrir" já resolve direto.)

Depois desse primeiro "Abrir Mesmo Assim", as próximas aberturas e as
atualizações automáticas passam a funcionar normalmente, sem pedir de novo.

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
