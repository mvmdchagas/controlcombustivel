import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, getDocs, writeBatch } from 'firebase/firestore';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// SUAS CREDENCIAIS REAIS DO FIREBASE ESTÃO INSERIDAS AQUI!
// Estas são as credenciais que você forneceu.
const firebaseConfig = {
    apiKey: "AIzaSyC6v-VIH2tfMHcwylxA3zRkmRTLdKAJ1_0",
    authDomain: "euecombustivel.firebaseapp.com",
    projectId: "euecombustivel",
    storageBucket: "euecombustivel.firebasestorage.app",
    messagingSenderId: "251014676991",
    appId: "1:251014676991:web:abc01e61234eeb2960e7ca"
};

// O appId para o caminho do Firestore é o mesmo que o appId da sua config
const appId = firebaseConfig.appId;

function App() {
    // Variáveis de estado do Firebase
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Variáveis de estado do aplicativo
    const [fuelEntries, setFuelEntries] = useState([]);
    const [vehicles, setVehicles] = useState([]); // Estado para armazenar veículos
    const [activeVehicle, setActiveVehicle] = useState(null); // Estado para o veículo atualmente selecionado
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [formError, setFormError] = useState(null); // Erro específico para validação do formulário

    // Variáveis de estado do modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [modalAction, setModalAction] = useState(null); // 'clearAll', 'deleteFuelEntry', ou 'deleteVehicle'
    const [deleteId, setDeleteId] = useState(null); // Para armazenar o ID do item a ser excluído
    const [showAddVehicleModal, setShowAddVehicleModal] = useState(false); // Modal para adicionar/editar veículos
    const [newVehicleName, setNewVehicleName] = useState(''); // Estado para o nome do novo veículo
    const [newVehicleEmoji, setNewVehicleEmoji] = useState('🚗'); // Estado para o emoji do veículo selecionado
    const [editingVehicleId, setEditingVehicleId] = useState(null); // Estado para edição de veículo

    // Variáveis de estado de entrada do formulário (para abastecimentos)
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [odometer, setOdometer] = useState('');
    const [liters, setLiters] = useState('');
    const [pricePerLiter, setPricePerLiter] = useState('');
    const [totalFuelCost, setTotalFuelCost] = useState(''); // Estado para o custo total do combustível
    const [editingId, setEditingId] = useState(null); // Armazena o ID do registro de abastecimento sendo editado

    // --- ESTADOS DE AUTENTICAÇÃO ---
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authMode, setAuthMode] = useState('login'); // 'login' ou 'signup' (cadastro)
    const [authError, setAuthError] = useState(null); // Erros específicos de autenticação
    const [showAuthForm, setShowAuthForm] = useState(true); // Controla a visibilidade do formulário de login/cadastro

    // Refs para manipulação do DOM
    const modalRef = useRef(null);
    const scrollToTopRef = useRef(null);

    // Função para definir a data e hora atuais, incluindo segundos para um timestamp único
    const setCurrentDateTime = () => {
        const now = new Date();
        const year = String(now.getFullYear()).padStart(4, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        setDate(`${year}-${month}-${day}`);
        setTime(`${hours}:${minutes}:${seconds}`);
    };

    // Função auxiliar para formatar números para o padrão brasileiro (ex: 1.234,56)
    // `options.maximumFractionDigits` pode ser ajustado para campos específicos (ex: litros)
    const formatNumberToBRL = (value, options = {}) => {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || value === '' || value === null || value === undefined) {
            return '';
        }
        const defaultOptions = {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2, // Padrão para 2 casas decimais para moeda/números gerais
            useGrouping: true, // Garante separadores de milhares
            ...options
        };
        return numValue.toLocaleString('pt-BR', defaultOptions);
    };

    // Função auxiliar para analisar uma string formatada em português brasileiro de volta para um número
    const parseBRLToNumber = (stringValue) => {
        if (typeof stringValue !== 'string' || stringValue.trim() === '') {
            return '';
        }
        // Remove separadores de milhares (pontos) e substitui a vírgula decimal por um ponto
        const cleanedString = stringValue.replace(/\./g, '').replace(/,/g, '.');
        const parsedValue = parseFloat(cleanedString);
        return isNaN(parsedValue) ? '' : parsedValue;
    };

    // Handler genérico para limpar a entrada ao focar
    const handleFocusClear = (setter) => () => {
        setter('');
    };

    // Handler genérico para campos de entrada numéricos (como hodômetro e agora litros) que permite decimais explícitos
    const handleSimpleNumericInputChange = (setter) => (e) => {
        let value = e.target.value;
        // Remove todos os caracteres não-dígitos, exceto uma única vírgula
        let cleaned = value.replace(/[^\d,]/g, '');

        // Garante apenas uma vírgula
        const parts = cleaned.split(',');
        if (parts.length > 2) {
            cleaned = parts[0] + ',' + parts.slice(1).join('');
        }

        // Se começar com vírgula, prefixa com '0'
        if (cleaned.startsWith(',')) {
            cleaned = '0' + cleaned;
        }

        // Divide em partes inteira e decimal novamente após a limpeza da vírgula
        const finalParts = cleaned.split(',');
        let integerPart = finalParts[0];
        let decimalPart = finalParts[1] || '';

        // Adiciona separadores de milhares à parte inteira
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

        // Reconstrói a string formatada
        setter(`${integerPart}${cleaned.includes(',') ? ',' : ''}${decimalPart}`);
    };

    // Handler específico para entrada de moeda (pricePerLiter, totalFuelCost)
    const handleCurrencyInputChange = (setter) => (e) => {
        let value = e.target.value;

        // 1. Remove todos os caracteres não-dígitos
        let cleanedDigits = value.replace(/[^\d]/g, '');

        if (cleanedDigits.length === 0) {
            setter('');
            return;
        }

        // Converte a string de dígitos para um número representando centavos
        const numValue = parseInt(cleanedDigits, 10) / 100;

        // Formata este número para exibição de moeda BRL
        const formattedValue = numValue.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            useGrouping: true // Isso adicionará separadores de milhares (pontos)
        });

        setter(formattedValue);
    };

    // Hook de efeito para inicialização e autenticação do Firebase
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);

            setDb(firestore);
            setAuth(firebaseAuth);

            // Escuta por mudanças no estado de autenticação
            const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    // Usuário está logado
                    setUserId(user.uid);
                    setIsAuthReady(true);
                    setShowAuthForm(false); // Oculta o formulário de autenticação se o usuário estiver logado
                    console.log("Firebase: Usuário autenticado. UID:", user.uid);
                } else {
                    // Usuário está deslogado ou não logado inicialmente
                    setUserId(null); // Garante que userId seja null se nenhum usuário for encontrado
                    setIsAuthReady(true); // Estado de autenticação determinado
                    setShowAuthForm(true); // Mostra o formulário de autenticação se nenhum usuário estiver logado
                    console.log("Firebase: Usuário desautenticado ou não logado.");
                }
                setLoading(false); // Para o carregamento assim que o estado de autenticação for determinado
                console.log("Firebase: Carregamento definido como falso.");
            });

            // Define a data e hora atuais no carregamento inicial do aplicativo
            setCurrentDateTime();

            return () => unsubscribe(); // Limpa o listener de autenticação ao desmontar o componente
        } catch (e) {
            console.error("Erro ao inicializar Firebase:", e);
            setError("Falha ao inicializar o aplicativo. Por favor, tente novamente.");
            setLoading(false);
        }
    }, []); // Array de dependência vazio significa que isso é executado uma vez na montagem

    // Hook de efeito para buscar veículos e registros de abastecimento quando o Firebase e o usuário estiverem prontos
    useEffect(() => {
        if (db && userId && isAuthReady) {
            // Buscar veículos
            const vehiclesCollectionPath = `/artifacts/${appId}/users/${userId}/vehicles`;
            // Ordenar veículos por tempo de criação para manter uma ordem consistente
            const qVehicles = query(collection(db, vehiclesCollectionPath), orderBy("createdAt", "asc"));
            const unsubscribeVehicles = onSnapshot(qVehicles, (snapshot) => {
                const fetchedVehicles = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setVehicles(fetchedVehicles);

                // Se nenhum veículo ativo estiver definido, ou o veículo ativo foi excluído, defina o primeiro como ativo
                if (!activeVehicle && fetchedVehicles.length > 0) {
                    setActiveVehicle(fetchedVehicles[0]);
                } else if (activeVehicle && !fetchedVehicles.some(v => v.id === activeVehicle.id)) {
                    // Se o veículo ativo anteriormente foi excluído, defina o primeiro veículo disponível ou nulo
                    setActiveVehicle(fetchedVehicles.length > 0 ? fetchedVehicles[0] : null);
                }
            }, (err) => {
                console.error("Erro ao carregar veículos:", err);
                setError("Falha ao carregar seus veículos.");
            });

            // Buscar registros de abastecimento (filtrados por activeVehicle, se definido)
            const fuelCollectionPath = `/artifacts/${appId}/users/${userId}/fuelEntries`;
            const qFuel = query(collection(db, fuelCollectionPath)); // Sem orderBy aqui, ordenação no lado do cliente

            const unsubscribeFuel = onSnapshot(qFuel, (snapshot) => {
                let entries = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                // Filtrar entradas pelo ID do veículo ativo
                if (activeVehicle) {
                    entries = entries.filter(entry => entry.vehicleId === activeVehicle.id);
                }
                // Ordenação no lado do cliente por timestamp
                setFuelEntries(entries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
            }, (err) => {
                console.error("Erro ao carregar abastecimentos:", err);
                setError("Falha ao carregar seus abastecimentos.");
            });

            return () => {
                unsubscribeVehicles(); // Limpa o listener de veículos
                unsubscribeFuel(); // Limpa o listener de registros de abastecimento
            };
        }
    }, [db, userId, isAuthReady, activeVehicle]); // Reexecuta quando activeVehicle muda para filtrar registros de abastecimento

    // Hook de efeito para calcular litros com base no custo total do combustível e preço por litro
    // Adicionado 'liters' ao array de dependência, pois pode ser alterado manualmente
    useEffect(() => {
        const parsedTotalFuelCost = parseBRLToNumber(totalFuelCost);
        const parsedPricePerLiter = parseBRLToNumber(pricePerLiter);

        // Calcula apenas se ambos os valores forem números válidos e pricePerLiter não for zero
        if (!isNaN(parsedTotalFuelCost) && !isNaN(parsedPricePerLiter) && parsedPricePerLiter > 0 && parsedTotalFuelCost !== '') {
            const calculatedLiters = parsedTotalFuelCost / parsedPricePerLiter;
            // Define litros com até 3 casas decimais para precisão
            setLiters(formatNumberToBRL(calculatedLiters, { minimumFractionDigits: 0, maximumFractionDigits: 3 }));
        } else if (totalFuelCost === '' && liters === '') { // Se totalFuelCost for limpo, limpa litros se litros também estiver vazio
            setLiters('');
        }
    }, [totalFuelCost, pricePerLiter, liters]); // Dependências: recalcula quando estas mudam, adicionado liters

    // Função para adicionar ou atualizar um veículo
    const handleSaveVehicle = async () => {
        if (!db || !userId) {
            setError("O banco de dados não está pronto.");
            return;
        }
        if (!newVehicleName.trim()) {
            setFormError("O nome do veículo não pode estar vazio.");
            return;
        }

        try {
            const vehiclesCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/vehicles`);
            if (editingVehicleId) {
                // Atualiza veículo existente
                const vehicleDocRef = doc(vehiclesCollectionRef, editingVehicleId);
                await updateDoc(vehicleDocRef, { name: newVehicleName.trim(), emoji: newVehicleEmoji });
                setEditingVehicleId(null); // Limpa o estado de edição
            } else {
                // Adiciona novo veículo
                await addDoc(vehiclesCollectionRef, {
                    name: newVehicleName.trim(),
                    emoji: newVehicleEmoji,
                    createdAt: Date.now() // Timestamp para ordenação
                });
            }
            setNewVehicleName(''); // Limpa a entrada
            setNewVehicleEmoji('🚗'); // Redefine o emoji para o padrão
            setShowAddVehicleModal(false); // Fecha o modal
            setFormError(null); // Limpa o erro do formulário
        } catch (e) {
            console.error("Erro ao salvar veículo:", e);
            setError("Falha ao salvar o veículo.");
        }
    };

    // Função para excluir um veículo e todos os seus registros de abastecimento associados
    const handleDeleteVehicle = async (vehicleToDeleteId) => {
        if (!db || !userId) {
            setError("O banco de dados não está pronto.");
            return;
        }

        try {
            const batch = writeBatch(db); // Usa um batch para exclusão atômica

            // 1. Excluir o documento do veículo em si
            const vehicleDocRef = doc(db, `/artifacts/${appId}/users/${userId}/vehicles`, vehicleToDeleteId);
            batch.delete(vehicleDocRef);

            // 2. Encontrar e excluir todos os registros de abastecimento associados a este veículo
            const fuelEntriesCollectionPath = `/artifacts/${appId}/users/${userId}/fuelEntries`;
            const q = query(collection(db, fuelEntriesCollectionPath));
            const snapshot = await getDocs(q); // Obtém todos os registros de abastecimento

            snapshot.docs.forEach((doc) => {
                if (doc.data().vehicleId === vehicleToDeleteId) {
                    batch.delete(doc.ref); // Adiciona ao batch se pertencer ao veículo
                }
            });

            await batch.commit(); // Confirma todas as exclusões de uma vez
            console.log(`Veículo e todos os abastecimentos associados (ID: ${vehicleToDeleteId}) foram excluídos.`);

            // Se o veículo ativo foi excluído, redefine o estado do veículo ativo
            if (activeVehicle && activeVehicle.id === vehicleToDeleteId) {
                setActiveVehicle(null);
            }
            setDeleteId(null); // Limpa o ID de exclusão
            setModalAction(null); // Limpa a ação do modal
        } catch (e) {
            console.error("Erro ao excluir veículo e seus abastecimentos:", e);
            setError("Falha ao excluir o veículo e seus abastecimentos.");
        }
    };


    // Função para calcular métricas de consumo geral para o veículo ativo
    const calculateOverallConsumption = (entries) => {
        if (entries.length < 2) {
            return { kmPerLiter: 'N/A', totalDistance: 0, totalLiters: 0 };
        }

        let totalDistance = 0;
        let totalLiters = 0;

        // As entradas já estão ordenadas por timestamp devido à ordenação no lado do cliente do `useEffect`
        const sortedEntries = [...entries];

        for (let i = 1; i < sortedEntries.length; i++) {
            const prevEntry = sortedEntries[i - 1];
            const currentEntry = sortedEntries[i];

            const prevOdometer = parseFloat(prevEntry.odometer);
            const currentOdometer = parseFloat(currentEntry.odometer);
            const currentLiters = parseFloat(currentEntry.liters);

            const distance = currentOdometer - prevOdometer;
            const liters = currentLiters;

            if (distance > 0 && liters > 0) {
                totalDistance += distance;
                totalLiters += liters;
            }
        }

        const kmPerLiterVal = totalLiters > 0 ? (totalDistance / totalLiters) : 0;
        return {
            kmPerLiter: formatNumberToBRL(kmPerLiterVal, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalDistance: formatNumberToBRL(totalDistance, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalLiters: formatNumberToBRL(totalLiters, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        };
    };

    const { kmPerLiter, totalDistance, totalLiters } = calculateOverallConsumption(fuelEntries);

    // Prepara dados para o gráfico de consumo (Km/L ao longo do tempo)
    const chartData = fuelEntries.reduce((acc, entry, index, array) => {
        if (index > 0) {
            const prevEntry = array[index - 1];
            const distance = parseFloat(entry.odometer) - parseFloat(prevEntry.odometer);
            const liters = parseFloat(entry.liters);
            const kmPerLiterSegment = distance > 0 && liters > 0 ? (distance / liters) : 0;
            acc.push({
                date: entry.date, // Usa a data para o rótulo do eixo X
                'Km/L': parseFloat(kmPerLiterSegment.toFixed(2)) // Garante números para o gráfico
            });
        }
        return acc;
    }, []);

    // Lida com o envio do formulário para adicionar ou atualizar um registro de abastecimento
    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormError(null); // Limpa erros anteriores do formulário

        if (!db || !userId) {
            setError("O banco de dados não está pronto. Por favor, aguarde.");
            return;
        }

        // Garante que um veículo seja selecionado antes de adicionar um registro de abastecimento
        if (!activeVehicle) {
            setFormError("Por favor, selecione um veículo antes de adicionar um abastecimento.");
            return;
        }

        // Analisa os valores de entrada formatados para números para validação e armazenamento
        const parsedOdometer = parseBRLToNumber(odometer);
        const parsedLiters = parseBRLToNumber(liters);
        const parsedPricePerLiter = parseBRLToNumber(pricePerLiter);
        const parsedTotalFuelCost = parseBRLToNumber(totalFuelCost);

        // Validação básica para entradas numéricas
        if (parsedOdometer === '' || parsedLiters === '' || parsedPricePerLiter === '' || isNaN(parsedOdometer) || isNaN(parsedLiters) || isNaN(parsedPricePerLiter)) {
            setFormError("Por favor, preencha todos os campos numéricos corretamente.");
            return;
        }

        // Validação do hodômetro: o hodômetro da nova entrada deve ser maior que o último para o *veículo ativo*
        if (!editingId) { // Aplica apenas para novas entradas
            const lastEntry = fuelEntries[fuelEntries.length - 1]; // fuelEntries já é filtrado por activeVehicle
            if (lastEntry && parsedOdometer <= parseFloat(lastEntry.odometer)) {
                setFormError("A leitura do hodômetro deve ser maior que a do último abastecimento registrado para este veículo.");
                return;
            }
        }

        let newEntry = {
            vehicleId: activeVehicle.id, // Associa ao veículo ativo
            odometer: parsedOdometer,
            liters: parsedLiters,
            pricePerLiter: parsedPricePerLiter,
            totalPrice: parsedTotalFuelCost, // Armazena o custo total do combustível inserido
            // Data e hora são definidas automaticamente para novas entradas
            date: date,
            time: time,
            timestamp: new Date(`${date}T${time}`).getTime(), // Timestamp para ordenação precisa
            createdAt: Date.now() // Fallback para timestamps idênticos extremamente raros
        };

        try {
            const collectionRef = collection(db, `/artifacts/${appId}/users/${userId}/fuelEntries`);
            if (editingId) {
                // Se estiver editando, atualiza o documento existente
                const docRef = doc(collectionRef, editingId);
                // Ao editar, preserva a data e o timestamp originais para manter a ordem cronológica
                const currentEntryData = fuelEntries.find(entry => entry.id === editingId);

                if (currentEntryData) {
                    newEntry.date = currentEntryData.date;
                    newEntry.time = currentEntryData.time;
                    newEntry.timestamp = currentEntryData.timestamp;
                } else {
                    // Fallback se os dados originais não forem encontrados (não deve acontecer com gerenciamento de estado adequado)
                    newEntry.date = date;
                    newEntry.time = time;
                    newEntry.timestamp = new Date(`${date}T${time}`).getTime();
                }
                await updateDoc(docRef, newEntry);
                setEditingId(null); // Limpa o estado de edição
            } else {
                // Se estiver adicionando nova entrada, adiciona um novo documento
                await addDoc(collectionRef, newEntry);
            }
            clearForm(); // Limpa as entradas do formulário após o envio bem-sucedido
        }
        catch (e) {
            console.error("Erro ao salvar abastecimento:", e);
            setError("Falha ao salvar o abastecimento. Verifique seus dados.");
        }
    };

    // Redefine o formulário de registro de abastecimento para seu estado inicial
    const clearForm = () => {
        setOdometer('');
        setLiters('');
        setPricePerLiter('');
        setTotalFuelCost(''); // Limpa o custo total do combustível
        setEditingId(null); // Limpa o ID de edição
        setFormError(null); // Limpa erros específicos do formulário
        setCurrentDateTime(); // Redefine a data/hora para a próxima entrada
    };

    // Preenche o formulário com dados de um registro de abastecimento existente para edição
    const handleEdit = (entry) => {
        setOdometer(formatNumberToBRL(entry.odometer, { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
        setLiters(formatNumberToBRL(entry.liters, { minimumFractionDigits: 0, maximumFractionDigits: 3 })); // Litros formatados com até 3 casas decimais
        setPricePerLiter(formatNumberToBRL(entry.pricePerLiter, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); // Preço por litro formatado como moeda
        setTotalFuelCost(formatNumberToBRL(entry.totalPrice, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); // Define o custo total do combustível
        setEditingId(entry.id); // Define o ID da entrada sendo editada
        setFormError(null); // Limpa quaisquer erros anteriores do formulário
        // Rola para o topo da página para mostrar o formulário para edição
        if (scrollToTopRef.current) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // Inicia o modal de confirmação de exclusão para um único registro de abastecimento
    const handleDeleteFuelEntry = (id) => {
        setModalAction('deleteFuelEntry'); // Ação específica para exclusão de registro de abastecimento
        setDeleteId(id);
        setShowConfirmModal(true);
    };

    // Inicia o modal de confirmação para limpar todos os registros do veículo ativo
    const handleClearAllEntries = () => {
        setModalAction('clearAll');
        setShowConfirmModal(true);
    };

    // Confirma e executa a ação do modal (excluir registro de abastecimento único, limpar tudo para veículo ativo ou excluir veículo)
    const confirmAction = async () => {
        setShowConfirmModal(false); // Fecha o modal
        if (!db || !userId) {
            setError("O banco de dados não está pronto.");
            return;
        }

        if (modalAction === 'clearAll') {
            try {
                if (!activeVehicle) {
                    setError("Nenhum veículo selecionado para apagar registros.");
                    return;
                }
                const fuelEntriesCollectionPath = `/artifacts/${appId}/users/${userId}/fuelEntries`; // Define o caminho aqui
                const q = query(collection(db, fuelEntriesCollectionPath));
                const snapshot = await getDocs(q);
                const batch = writeBatch(db);

                // Filtra e exclui apenas as entradas associadas ao veículo ativo
                snapshot.docs.forEach((doc) => {
                    if (doc.data().vehicleId === activeVehicle.id) {
                        batch.delete(doc.ref);
                    }
                });
                await batch.commit(); // Confirma todas as exclusões de uma vez
                console.log(`Todos os abastecimentos para o veículo ${activeVehicle.name} foram excluídos.`);
                clearForm(); // Limpa o formulário após excluir todas as entradas
            } catch (e) {
                console.error("Erro ao excluir todos os abastecimentos:", e);
                setError("Falha ao excluir todos os abastecimentos.");
            }
        } else if (modalAction === 'deleteFuelEntry' && deleteId) {
            try {
                const docRef = doc(db, `/artifacts/${appId}/users/${userId}/fuelEntries`, deleteId);
                await deleteDoc(docRef);
                setDeleteId(null); // Limpa o ID de exclusão após a exclusão
            } catch (e) {
                console.error("Erro ao excluir abastecimento:", e);
                setError("Falha ao excluir o abastecimento.");
            }
        } else if (modalAction === 'deleteVehicle' && deleteId) {
            await handleDeleteVehicle(deleteId); // Chama a função dedicada de exclusão de veículo
        }
        setModalAction(null); // Redefine o estado da ação do modal
    };

    // Cancela a ação do modal e fecha o modal
    const cancelAction = () => {
        setShowConfirmModal(false);
        setModalAction(null);
        setDeleteId(null);
    };

    // --- FUNÇÕES DE AUTENTICAÇÃO ---
    const handleSignUp = async (e) => {
        e.preventDefault();
        setAuthError(null); // Limpa erros anteriores
        if (!auth) {
            setAuthError("Serviço de autenticação não disponível.");
            return;
        }
        if (password.length < 6) {
            setAuthError("A senha deve ter pelo menos 6 caracteres.");
            return;
        }
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged no useEffect detectará o login e definirá o userId
            console.log("Usuário cadastrado e logado!");
            setEmail('');
            setPassword('');
            setAuthMode('login'); // Volta para login após cadastro
        } catch (error) {
            console.error("Erro ao cadastrar:", error);
            if (error.code === 'auth/email-already-in-use') {
                setAuthError("Este e-mail já está em uso.");
            } else if (error.code === 'auth/invalid-email') {
                setAuthError("Formato de e-mail inválido.");
            } else {
                setAuthError("Erro ao cadastrar. Tente novamente.");
            }
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setAuthError(null); // Limpa erros anteriores
        if (!auth) {
            setAuthError("Serviço de autenticação não disponível.");
            return;
        }
        try {
            await signInWithEmailAndPassword(auth, email, password);
            console.log("Usuário logado!");
            setEmail('');
            setPassword('');
        } catch (error) {
            console.error("Erro ao fazer login:", error);
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                setAuthError("E-mail ou senha inválidos.");
            } else {
                setAuthError("Erro ao fazer login. Tente novamente.");
            }
        }
    };

    const handleLogout = async () => {
        setAuthError(null); // Limpa erros anteriores
        if (!auth) {
            setAuthError("Serviço de autenticação não disponível.");
            return;
        }
        try {
            await signOut(auth);
            setUserId(null); // Limpa o userId no estado
            setActiveVehicle(null); // Limpa o veículo ativo
            setFuelEntries([]); // Limpa os abastecimentos
            setVehicles([]); // Limpa os veículos
            setShowAuthForm(true); // Mostra o formulário de autenticação após o logout
            console.log("Usuário deslogado!");
        } catch (error) {
            console.error("Erro ao deslogar:", error);
            setAuthError("Falha ao deslogar. Tente novamente.");
        }
    };
    // --- FIM DAS FUNÇÕES DE AUTENTICAÇÃO ---


    // Hook de efeito para focar o modal quando ele aparece
    useEffect(() => {
        if (showConfirmModal && modalRef.current) {
            modalRef.current.focus();
        }
    }, [showConfirmModal]);

    // Hook de efeito para gerenciar a visibilidade do botão de rolar para o topo
    useEffect(() => {
        const handleScroll = () => {
            if (scrollToTopRef.current) {
                if (window.scrollY > 200) { // Mostra o botão após rolar 200px para baixo
                    scrollToTopRef.current.classList.remove('hidden');
                } else {
                    scrollToTopRef.current.classList.add('hidden');
                }
            }
        };
        window.addEventListener('scroll', handleScroll);
        // Garante que o botão esteja oculto no carregamento inicial se não estiver rolado
        if (scrollToTopRef.current) {
            scrollToTopRef.current.classList.add('hidden');
        }
        return () => window.removeEventListener('scroll', handleScroll); // Limpa o listener de eventos
    }, []);

    // Exibe o estado de carregamento
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <p className="text-xl text-gray-700">Carregando aplicativo... 🚀</p>
            </div>
        );
    }

    // Exibe o estado de erro
    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-100 text-red-700 p-4 rounded-lg">
                <p className="text-xl">{error}</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 sm:p-8 font-sans antialiased">
            <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl p-6 sm:p-8">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-center text-gray-800 mb-8">
                    Controle de Gasto de Combustível <span role="img" aria-label="bomba de combustível">⛽</span>
                </h1>

                {/* Seção de Mensagem de Boas-Vindas e Informações do Usuário */}
                <div className="mb-8 p-4 bg-yellow-50 rounded-xl shadow-inner text-center">
                    <h2 className="text-2xl font-bold text-gray-700">
                        Bem-vindo! <span role="img" aria-label="mão acenando">👋</span>
                    </h2>
                    {userId && auth?.currentUser?.email && (
                        <p className="text-lg text-gray-700 mt-2 flex items-center justify-center flex-wrap gap-2">
                            Você está logado com o e-mail: <span className="font-mono bg-gray-100 px-2 py-1 rounded break-all">{auth.currentUser.email}</span>
                            {/* Botão Sair - agora um link discreto */}
                            <button
                                onClick={handleLogout}
                                className="text-red-500 hover:underline focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-75 transition duration-200 text-base ml-2"
                                title="Sair da conta"
                            >
                                Sair
                            </button>
                        </p>
                    )}
                </div>

                {/* Seção de Autenticação (Formulário de Login/Cadastro) */}
                {showAuthForm && ( // Renderiza esta seção APENAS se o formulário de autenticação deve ser mostrado
                    <div className="mb-10 p-6 bg-gray-100 rounded-xl shadow-inner text-center">
                        <h2 className="text-2xl font-bold text-gray-700 mb-4">Autenticação</h2>
                        <div>
                            <form onSubmit={authMode === 'login' ? handleLogin : handleSignUp} className="space-y-4">
                                <input
                                    type="email"
                                    placeholder="E-mail"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-200"
                                    required
                                />
                                <input
                                    type="password"
                                    placeholder="Senha"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-200"
                                    required
                                />
                                <button
                                    type="submit"
                                    className="w-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-75 transition duration-200"
                                >
                                    {authMode === 'login' ? 'Entrar' : 'Cadastrar'}
                                </button>
                            </form>
                            <button
                                onClick={() => {
                                    setAuthMode(authMode === 'login' ? 'signup' : 'login');
                                    setAuthError(null); // Limpa o erro ao trocar de modo
                                }}
                                className="mt-4 text-indigo-600 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-75 transition duration-200"
                            >
                                {authMode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Faça login'}
                            </button>
                            {authError && <p className="text-red-600 text-sm mt-4">{authError}</p>}
                        </div>
                    </div>
                )}

                {/* Renderiza o restante do conteúdo APENAS se o usuário estiver logado */}
                {userId && (
                    <>
                        {/* Seção de Gerenciamento de Veículos */}
                        <div className="mb-10 p-6 bg-purple-50 rounded-xl shadow-inner">
                            <div className="flex items-center justify-center mb-6">
                                <h2 className="text-2xl font-bold text-gray-700 mr-3">Meus Veículos</h2>
                                {/* Botão Discreto Adicionar Veículo */}
                                <button
                                    onClick={() => {
                                        setNewVehicleName('');
                                        setNewVehicleEmoji('🚗'); // Redefine o emoji para novo veículo
                                        setEditingVehicleId(null); // Limpa o estado de edição
                                        setShowAddVehicleModal(true); // Abre o modal de adicionar veículo
                                        setFormError(null); // Limpa quaisquer erros anteriores do formulário
                                    }}
                                    className="p-2 bg-purple-600 text-white rounded-full shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 transition duration-200"
                                    title="Adicionar Novo Veículo"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                    </svg>
                                </button>
                            </div>
                            <div className="flex flex-wrap justify-center gap-4 mb-6">
                                {vehicles.map(vehicle => (
                                    <div
                                        key={vehicle.id}
                                        className={`relative flex flex-col items-center p-4 rounded-xl cursor-pointer transition duration-200
                                            ${activeVehicle && activeVehicle.id === vehicle.id ? 'bg-purple-200 shadow-md border-2 border-purple-500' : 'bg-purple-100 hover:bg-purple-200'}
                                            w-32 sm:w-40`}
                                        onClick={() => setActiveVehicle(vehicle)}
                                    >
                                        <span className="text-4xl mb-2" role="img" aria-label={vehicle.name}>{vehicle.emoji || '🚗'}</span>
                                        <p className="font-semibold text-gray-800 text-center truncate w-full">{vehicle.name}</p>
                                        {/* Botão Editar Veículo (pequeno, discreto) */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation(); // Previne a seleção do veículo ao editar
                                                setNewVehicleName(vehicle.name);
                                                setNewVehicleEmoji(vehicle.emoji || '🚗');
                                                setEditingVehicleId(vehicle.id);
                                                setShowAddVehicleModal(true);
                                                setFormError(null);
                                            }}
                                            className="absolute top-1 left-1 bg-gray-300 text-gray-800 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold hover:bg-gray-400 transition duration-200"
                                            title="Editar Veículo"
                                        >
                                            <span role="img" aria-label="lápis">✏️</span>
                                        </button>
                                        {/* Botão Excluir Veículo */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation(); // Previne a seleção do veículo ao excluir
                                                setModalAction('deleteVehicle');
                                                setDeleteId(vehicle.id);
                                                setShowConfirmModal(true);
                                            }}
                                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold hover:bg-red-600 transition duration-200"
                                            title="Excluir Veículo"
                                        >
                                            <span role="img" aria-label="cruz">✕</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Modal Adicionar/Editar Veículo */}
                        {showAddVehicleModal && (
                            <div
                                className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
                                onClick={() => setShowAddVehicleModal(false)} // Fecha o modal ao clicar fora
                            >
                                <div
                                    className="bg-white rounded-lg p-8 shadow-2xl max-w-sm w-full text-center"
                                    onClick={(e) => e.stopPropagation()} // Previne o fechamento do modal ao clicar dentro
                                >
                                    <h3 className="text-xl font-bold text-gray-800 mb-4">{editingVehicleId ? 'Editar Veículo' : 'Adicionar Novo Veículo'}</h3>
                                    <input
                                        type="text"
                                        value={newVehicleName}
                                        onChange={(e) => setNewVehicleName(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 transition duration-200 mb-4"
                                        placeholder="Nome do Veículo (Ex: Moto, Carro)"
                                        required
                                    />
                                    {/* Seleção de Emoji */}
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Escolha um Ícone:</label>
                                        <div className="flex justify-center space-x-4">
                                            <button
                                                type="button"
                                                onClick={() => setNewVehicleEmoji('🚗')}
                                                className={`p-3 rounded-lg text-4xl transition duration-200 ${newVehicleEmoji === '🚗' ? 'bg-blue-200 border-2 border-blue-500' : 'bg-gray-100 hover:bg-gray-200'}`}
                                            >
                                                <span role="img" aria-label="carro">🚗</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setNewVehicleEmoji('🏍️')}
                                                className={`p-3 rounded-lg text-4xl transition duration-200 ${newVehicleEmoji === '🏍️' ? 'bg-blue-200 border-2 border-blue-500' : 'bg-gray-100 hover:bg-gray-200'}`}
                                            >
                                                <span role="img" aria-label="moto">🏍️</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setNewVehicleEmoji('🚚')}
                                                className={`p-3 rounded-lg text-4xl transition duration-200 ${newVehicleEmoji === '🚚' ? 'bg-blue-200 border-2 border-blue-500' : 'bg-gray-100 hover:bg-gray-200'}`}
                                            >
                                                <span role="img" aria-label="caminhão">🚚</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setNewVehicleEmoji('🚲')}
                                                className={`p-3 rounded-lg text-4xl transition duration-200 ${newVehicleEmoji === '🚲' ? 'bg-blue-200 border-2 border-blue-500' : 'bg-gray-100 hover:bg-gray-200'}`}
                                            >
                                                <span role="img" aria-label="bicicleta">🚲</span>
                                            </button>
                                        </div>
                                    </div>

                                    {formError && <p className="text-red-600 text-sm mb-4">{formError}</p>}
                                    <div className="flex justify-center space-x-4">
                                        <button
                                            onClick={handleSaveVehicle}
                                            className="px-6 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition duration-200"
                                        >
                                            Salvar
                                        </button>
                                        <button
                                            onClick={() => setShowAddVehicleModal(false)}
                                            className="px-6 py-2 bg-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-400 transition duration-200"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Seção do Formulário de Abastecimento */}
                        <div className="mb-10 p-6 bg-blue-50 rounded-xl shadow-inner">
                            <h2 className="text-2xl font-bold text-gray-700 mb-6 text-center">
                                Registrar Abastecimento <span role="img" aria-label="bomba de combustível">⛽</span>
                            </h2>
                            {activeVehicle ? (
                                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Entrada do Hodômetro (km) */}
                                    <div>
                                        <label htmlFor="odometer" className="block text-sm font-medium text-gray-700 mb-1">Hodômetro (km) <span role="img" aria-label="estrada">🛣️</span></label>
                                        <input
                                            type="text"
                                            id="odometer"
                                            value={odometer}
                                            onChange={handleSimpleNumericInputChange(setOdometer)}
                                            onFocus={handleFocusClear(setOdometer)}
                                            onBlur={() => setOdometer(formatNumberToBRL(parseBRLToNumber(odometer), { minimumFractionDigits: 0, maximumFractionDigits: 2 }))}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200"
                                            placeholder="Ex: 15.000"
                                            required
                                        />
                                    </div>
                                    {/* Entrada do Preço por Litro (R$) */}
                                    <div>
                                        <label htmlFor="pricePerLiter" className="block text-sm font-medium text-gray-700 mb-1">Preço por Litro (R$) <span role="img" aria-label="saco de dinheiro">💰</span></label>
                                        <input
                                            type="text"
                                            id="pricePerLiter"
                                            value={pricePerLiter}
                                            onChange={handleCurrencyInputChange(setPricePerLiter)}
                                            onFocus={handleFocusClear(setPricePerLiter)}
                                            onBlur={() => setPricePerLiter(formatNumberToBRL(parseBRLToNumber(pricePerLiter), { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200"
                                            placeholder="Ex: 5,99 (digite 599 para 5,99)"
                                            required
                                        />
                                    </div>
                                    {/* Entrada do Valor Abastecido (R$) */}
                                    <div>
                                        <label htmlFor="totalFuelCost" className="block text-sm font-medium text-gray-700 mb-1">Valor Abastecido (R$) <span role="img" aria-label="dinheiro voando">💸</span></label>
                                        <input
                                            type="text"
                                            id="totalFuelCost"
                                            value={totalFuelCost}
                                            onChange={handleCurrencyInputChange(setTotalFuelCost)}
                                            onFocus={handleFocusClear(setTotalFuelCost)}
                                            onBlur={() => setTotalFuelCost(formatNumberToBRL(parseBRLToNumber(totalFuelCost), { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200"
                                            placeholder="Ex: 50,00 (digite 5000 para 50,00)"
                                            required
                                        />
                                    </div>
                                    {/* Entrada de Litros (L) - agora pode ser calculado ou inserido manualmente */}
                                    <div>
                                        <label htmlFor="liters" className="block text-sm font-medium text-gray-700 mb-1">Litros (L) <span role="img" aria-label="gota de água">💧</span></label>
                                        <input
                                            type="text"
                                            id="liters"
                                            value={liters}
                                            onChange={handleSimpleNumericInputChange(setLiters)}
                                            onFocus={handleFocusClear(setLiters)}
                                            onBlur={() => setLiters(formatNumberToBRL(parseBRLToNumber(liters), { minimumFractionDigits: 0, maximumFractionDigits: 3 }))}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200"
                                            placeholder="Ex: 6,596"
                                            required
                                        />
                                    </div>
                                    {/* Botões de ação do formulário */}
                                    <div className="md:col-span-2 flex flex-col sm:flex-row justify-center gap-4 mt-4">
                                        <button
                                            type="submit"
                                            className="flex-1 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition duration-200"
                                        >
                                            {editingId ? 'Salvar Alterações' : 'Adicionar Abastecimento'}
                                        </button>
                                        {editingId && (
                                            <button
                                                type="button"
                                                onClick={clearForm}
                                                className="flex-1 px-6 py-3 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-opacity-75 transition duration-200"
                                            >
                                                Cancelar Edição
                                            </button>
                                        )}
                                    </div>
                                    {formError && (
                                        <p className="md:col-span-2 text-red-600 text-center text-sm mt-2">{formError}</p>
                                    )}
                                </form>
                            ) : (
                                <p className="text-center text-gray-500">Adicione ou selecione um veículo para registrar abastecimentos.</p>
                            )}
                        </div>

                        {/* Seção de Resumo do Consumo Geral */}
                        <div className="mb-10 p-6 bg-green-50 rounded-xl shadow-inner text-center">
                            <h2 className="text-2xl font-bold text-gray-700 mb-4">Consumo Médio Geral <span role="img" aria-label="gráfico de barras">📊</span></h2>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-gray-800">
                                <div>
                                    <p className="text-lg font-semibold">Km/L:</p>
                                    <p className="text-2xl font-extrabold text-green-700">{kmPerLiter} km/L</p>
                                </div>
                                <div>
                                    <p className="text-lg font-semibold">Distância Total:</p>
                                    <p className="text-2xl font-extrabold text-green-700">{totalDistance} km</p>
                                </div>
                                <div>
                                    <p className="text-lg font-semibold">Litros Totais:</p>
                                    <p className="text-2xl font-extrabold text-green-700">{totalLiters} L</p>
                                </div>
                            </div>
                        </div>

                        {/* Seção da Tabela de Registros de Abastecimento */}
                        <div className="mb-10">
                            <h2 className="text-2xl font-bold text-gray-700 mb-6 text-center">Registros de Abastecimento</h2>
                            {fuelEntries.length === 0 ? (
                                <p className="text-center text-gray-500">Nenhum registro de abastecimento para este veículo ainda. Adicione um acima! <span role="img" aria-label="bloco de notas">📝</span></p>
                            ) : (
                                <div className="overflow-x-auto rounded-lg shadow-md border border-gray-200">
                                    <table className="min-w-full bg-white">
                                        <thead className="bg-gray-100">
                                            <tr>
                                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Data</th>
                                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Hodômetro (km)</th>
                                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Litros</th>
                                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">R$/Litro</th>
                                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Custo Total (R$)</th>
                                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Consumo (km/L)</th>
                                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {fuelEntries.map((entry, index, array) => {
                                                const prevEntry = index > 0 ? array[index - 1] : null;
                                                const currentOdometer = parseFloat(entry.odometer);
                                                const currentLiters = parseFloat(entry.liters);
                                                const currentTotalPrice = parseFloat(entry.totalPrice);

                                                let kmPerLiterSegment = 'N/A';

                                                if (prevEntry) {
                                                    const prevOdometer = parseFloat(prevEntry.odometer);
                                                    const distance = currentOdometer - prevOdometer;

                                                    if (distance > 0 && currentLiters > 0) {
                                                        kmPerLiterSegment = formatNumberToBRL(distance / currentLiters, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                                    }
                                                }

                                                return (
                                                    <tr key={entry.id} className="border-b border-gray-200 hover:bg-gray-50 transition duration-150">
                                                        <td className="py-3 px-4 text-sm text-gray-700">{entry.date}</td>
                                                        <td className="py-3 px-4 text-sm text-gray-700">{formatNumberToBRL(entry.odometer)}</td>
                                                        <td className="py-3 px-4 text-sm text-gray-700">{formatNumberToBRL(entry.liters, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                                                        <td className="py-3 px-4 text-sm text-gray-700">R$ {formatNumberToBRL(entry.pricePerLiter, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                        <td className="py-3 px-4 text-sm text-gray-700">R$ {formatNumberToBRL(currentTotalPrice, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                        <td className="py-3 px-4 text-sm text-gray-700">{kmPerLiterSegment}</td>
                                                        <td className="py-3 px-4 text-sm">
                                                            <button
                                                                onClick={() => handleEdit(entry)}
                                                                className="text-blue-600 hover:text-blue-800 font-medium mr-3 transition duration-150"
                                                            >
                                                                Editar
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteFuelEntry(entry.id)}
                                                                className="text-red-600 hover:text-red-800 font-medium transition duration-150"
                                                            >
                                                                Excluir
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {/* Botão Limpar Todos os Registros - para o veículo ativo */}
                            {fuelEntries.length > 0 && (
                                <div className="flex justify-center mt-6">
                                    <button
                                        type="button"
                                        onClick={handleClearAllEntries}
                                        className="px-6 py-3 bg-red-500 text-white font-semibold rounded-lg shadow-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-75 transition duration-200"
                                    >
                                        Apagar Todos os Registros <span role="img" aria-label="lixeira">🗑️</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Seção do Gráfico de Consumo */}
                        {chartData.length > 0 && (
                            <div className="mb-10 p-6 bg-white rounded-xl shadow-lg">
                                <h2 className="text-2xl font-bold text-gray-700 mb-6 text-center">Gráfico de Consumo (Km/L)</h2>
                                <ResponsiveContainer width="100%" height={300}>
                                    <LineChart
                                        data={chartData}
                                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                                        <XAxis dataKey="date" stroke="#666" />
                                        <YAxis stroke="#666" label={{ value: 'Km/L', angle: -90, position: 'insideLeft' }} />
                                        <Tooltip
                                            formatter={(value, name) => [`${formatNumberToBRL(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/L`, name]}
                                            labelFormatter={(label) => `Data: ${label}`}
                                        />
                                        <Legend />
                                        <Line type="monotone" dataKey="Km/L" stroke="#4F46E5" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 8 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}

                        {/* Botão Rolar para o Topo */}
                        <button
                            ref={scrollToTopRef}
                            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                            className="fixed bottom-6 right-6 p-4 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition duration-200 hidden"
                            title="Rolar para o topo"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                        </button>

                        {/* Modal de Confirmação (para registros de abastecimento e veículos) */}
                        {showConfirmModal && (
                            <div
                                className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
                                onClick={cancelAction} // Fecha o modal ao clicar fora
                            >
                                <div
                                    ref={modalRef}
                                    className="bg-white rounded-lg p-8 shadow-2xl max-w-sm w-full text-center focus:outline-none"
                                    tabIndex="-1" // Torna o conteúdo do modal focável
                                    onClick={(e) => e.stopPropagation()} // Previne o fechamento do modal ao clicar dentro
                                >
                                    <h3 className="text-xl font-bold text-gray-800 mb-4">
                                        {modalAction === 'clearAll' ? `Apagar Todos os Registros ${activeVehicle ? `(${activeVehicle.name})` : ''}?` :
                                         modalAction === 'deleteFuelEntry' ? 'Excluir Abastecimento?' :
                                         'Excluir Veículo?'}
                                    </h3>
                                    <p className="text-gray-600 mb-6">
                                        {modalAction === 'clearAll' ?
                                            `Tem certeza que deseja apagar TODOS os registros de abastecimento para ${activeVehicle ? activeVehicle.name : 'o veículo selecionado'}? Esta ação é irreversível.` :
                                         modalAction === 'deleteFuelEntry' ?
                                            'Tem certeza que deseja excluir este registro de abastecimento?' :
                                            'Tem certeza que deseja excluir este veículo? Todos os registros de abastecimento associados a ele também serão excluídos. Esta ação é irreversível.'
                                        }
                                    </p>
                                    <div className="flex justify-center space-x-4">
                                        <button
                                            onClick={confirmAction}
                                            className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-75 transition duration-200"
                                        >
                                            Confirmar
                                        </button>
                                        <button
                                            onClick={cancelAction}
                                            className="px-6 py-2 bg-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-opacity-75 transition duration-200"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default App;
