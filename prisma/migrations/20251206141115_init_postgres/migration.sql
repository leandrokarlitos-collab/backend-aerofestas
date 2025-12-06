-- CreateTable
CREATE TABLE "Toy" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "Toy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" DOUBLE PRECISION NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "cpf" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" DOUBLE PRECISION NOT NULL,
    "date" TEXT NOT NULL,
    "clientName" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventItem" (
    "id" SERIAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "eventId" DOUBLE PRECISION NOT NULL,
    "toyId" INTEGER,

    CONSTRAINT "EventItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nascimento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "cnh" BOOLEAN DEFAULT false,
    "cnhCategoria" TEXT,
    "fotoPerfil" TEXT,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Desempenho" (
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "descricao" TEXT,
    "nota" TEXT,
    "obs" TEXT,
    "detalhes" TEXT,
    "monitorId" TEXT NOT NULL,

    CONSTRAINT "Desempenho_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_toyId_fkey" FOREIGN KEY ("toyId") REFERENCES "Toy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desempenho" ADD CONSTRAINT "Desempenho_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
