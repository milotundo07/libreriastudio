# Biblioteca dello Studio

Applicazione statica per GitHub Pages che permette di catalogare una biblioteca personale e riconoscere i libri tramite scansione del codice a barre ISBN.

## File da caricare nella root del repository

- `index.html`
- `app.js`
- `styles.css`
- `README.md`

## Pubblicazione su GitHub Pages

1. Carica questi file direttamente nella cartella principale del repository.
2. Vai su **Settings → Pages**.
3. In **Build and deployment**, scegli **Deploy from a branch**.
4. Seleziona il branch `main` e la cartella `/ (root)`.
5. Salva.

L'app sarà disponibile all'indirizzo:

`https://milotundo07.github.io/libreriastudio/`

## Dati e backup

I libri vengono salvati nel browser tramite IndexedDB. Non vengono caricati su GitHub.

Usa regolarmente **Backup JSON**. Il file JSON può essere importato su un altro computer o telefono tramite il pulsante **Importa JSON**.

## Funzioni

- scansione ISBN/EAN-13 con fotocamera;
- riconoscimento tramite Open Library e Google Books;
- inserimento e modifica manuale;
- ricerca, filtri e ordinamento;
- collocazione per stanza e scaffale;
- stato e condizione del libro;
- campi personalizzati;
- esportazione JSON e CSV;
- importazione di backup JSON.
