# Biblioteca dello Studio

Applicazione web locale per catalogare una biblioteca personale e aggiungere libri tramite scansione del codice a barre ISBN.

## Funzioni incluse

- scansione ISBN/EAN-13 con webcam o fotocamera;
- recupero automatico dei dati da Open Library e Google Books;
- archivio locale SQLite, senza server di database;
- titolo, sottotitolo, autori, anno e data di pubblicazione, editore, lingua, pagine, categorie e copertina;
- stanza, scaffale, stato, condizione, data di acquisizione e note;
- campi personalizzati aggiungibili liberamente;
- ricerca, filtri, ordinamento, modifica ed eliminazione;
- controllo dei duplicati ISBN;
- esportazione completa in CSV.

## Avvio rapido su Windows

1. Installa Python 3.11 o successivo.
2. Estrai la cartella del progetto.
3. Fai doppio clic su `run_windows.bat`.
4. Si apre `http://127.0.0.1:5000`.

Al primo avvio vengono installate automaticamente le dipendenze. Il database viene creato nel file `biblioteca.db` dentro la cartella del progetto.

## Avvio su macOS o Linux

Nel terminale:

```bash
cd biblioteca_studio
./run_mac_linux.sh
```

## Uso della fotocamera

- Sullo stesso computer, apri l'app tramite `http://127.0.0.1:5000`: la webcam funziona normalmente nei browser moderni.
- Su uno smartphone collegato alla stessa rete, l'app è raggiungibile usando l'indirizzo IP del computer, ma molti browser bloccano la fotocamera su connessioni HTTP non protette.
- Per usare comodamente la fotocamera del telefono, pubblica l'app su un servizio HTTPS oppure aprila direttamente sul dispositivo che esegue il programma.

## Avvio con Waitress

Per un'esecuzione più stabile su Windows:

```bash
waitress-serve --host=0.0.0.0 --port=5000 app:app
```

## Chiave Google Books facoltativa

Per uso personale non è normalmente necessaria. Se disponibile, imposta la variabile d'ambiente:

```bash
GOOGLE_BOOKS_API_KEY=la_tua_chiave
```

## Test

Installa pytest e avvia:

```bash
pip install pytest
pytest
```

## Aggiungere nuovi campi strutturati

I dati ancora da definire possono già essere salvati nei “Campi personalizzati”. Quando l'elenco definitivo sarà stabilito, si possono trasformare i campi più importanti in colonne dedicate, filtri o statistiche senza perdere i dati esistenti.

## Connessione internet

La scansione usa una libreria JavaScript caricata da CDN e il recupero dei metadati usa cataloghi online. La catalogazione e la consultazione dei libri già salvati funzionano invece sul database locale.
