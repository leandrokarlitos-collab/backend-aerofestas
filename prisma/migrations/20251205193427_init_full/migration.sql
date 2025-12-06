-- CreateTable
CREATE TABLE "Toy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Client" (
    "id" REAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "cpf" TEXT
);

-- CreateTable
CREATE TABLE "Event" (
    "id" REAL NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "clientName" TEXT
);

-- CreateTable
CREATE TABLE "EventItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quantity" INTEGER NOT NULL,
    "eventId" REAL NOT NULL,
    "toyId" INTEGER,
    CONSTRAINT "EventItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventItem_toyId_fkey" FOREIGN KEY ("toyId") REFERENCES "Toy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "nascimento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "cnh" BOOLEAN DEFAULT false,
    "cnhCategoria" TEXT,
    "fotoPerfil" TEXT
);

-- CreateTable
CREATE TABLE "Desempenho" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "descricao" TEXT,
    "nota" TEXT,
    "obs" TEXT,
    "detalhes" TEXT,
    "monitorId" TEXT NOT NULL,
    CONSTRAINT "Desempenho_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
