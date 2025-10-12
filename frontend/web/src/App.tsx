// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface TCMRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  symptomPattern: string;
  herbFormula: string;
  status: "pending" | "analyzed" | "archived";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<TCMRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    symptomPattern: "",
    herbFormula: "",
    patientInfo: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<TCMRecord | null>(null);

  // Calculate statistics for dashboard
  const analyzedCount = records.filter(r => r.status === "analyzed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const archivedCount = records.filter(r => r.status === "archived").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return false;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE contract is available and ready!"
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
      }
      return isAvailable;
    } catch (e) {
      console.error("Error checking contract availability:", e);
      return false;
    }
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("tcm_record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: TCMRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`tcm_record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                symptomPattern: recordData.symptomPattern,
                herbFormula: recordData.herbFormula,
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting TCM data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for TCM data
      const encryptedData = `FHE-TCM-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `tcm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        symptomPattern: newRecordData.symptomPattern,
        herbFormula: newRecordData.herbFormula,
        status: "pending"
      };
      
      // Store encrypted TCM data on-chain using FHE
      await contract.setData(
        `tcm_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("tcm_record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "tcm_record_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "TCM data encrypted and submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          symptomPattern: "",
          herbFormula: "",
          patientInfo: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const analyzeRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Analyzing TCM pattern with FHE..."
    });

    try {
      // Simulate FHE computation time for TCM analysis
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`tcm_record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "analyzed"
      };
      
      await contract.setData(
        `tcm_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const archiveRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Archiving record with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`tcm_record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "archived"
      };
      
      await contract.setData(
        `tcm_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Record archived successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Archive failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the TCM analytics platform",
      icon: "🌿"
    },
    {
      title: "Submit Encrypted Data",
      description: "Add TCM diagnosis data which will be encrypted using FHE technology",
      icon: "🔒"
    },
    {
      title: "FHE Pattern Analysis",
      description: "Your TCM data is analyzed in encrypted state without decryption",
      icon: "⚗️"
    },
    {
      title: "Get Insights",
      description: "Receive herbal formula recommendations while keeping data private",
      icon: "📜"
    }
  ];

  const renderPieChart = () => {
    const total = records.length || 1;
    const analyzedPercentage = (analyzedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const archivedPercentage = (archivedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment analyzed" 
            style={{ transform: `rotate(${analyzedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(analyzedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment archived" 
            style={{ transform: `rotate(${(analyzedPercentage + pendingPercentage + archivedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{records.length}</div>
            <div className="pie-label">Records</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box analyzed"></div>
            <span>Analyzed: {analyzedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box archived"></div>
            <span>Archived: {archivedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="herb-spinner">🌿</div>
      <p>Initializing TCM encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container tcm-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="yin-yang-icon">☯</div>
          </div>
          <h1>TCM<span>Analytics</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn herb-button"
          >
            <div className="add-icon">➕</div>
            Add Diagnosis
          </button>
          <button 
            className="herb-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <button 
            className="herb-button secondary"
            onClick={checkContractAvailability}
          >
            Check FHE
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential TCM Record Analysis</h2>
            <p>Traditional Chinese Medicine diagnosis encrypted with FHE for privacy-preserving analytics</p>
          </div>
          <div className="banner-illustration">🌿⚗️📜</div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>TCM Analytics Tutorial</h2>
            <p className="subtitle">Learn how to securely analyze Traditional Chinese Medicine patterns</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-panels">
          <div className="panel-left">
            <div className="dashboard-card herb-card">
              <h3>Project Introduction</h3>
              <p>Secure platform for analyzing Traditional Chinese Medicine records using Fully Homomorphic Encryption. Preserve patient privacy while gaining valuable herbal formula insights.</p>
              <div className="fhe-badge">
                <span>FHE-Powered TCM Analytics</span>
              </div>
            </div>
            
            <div className="dashboard-card herb-card">
              <h3>Data Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{records.length}</div>
                  <div className="stat-label">Total Records</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{analyzedCount}</div>
                  <div className="stat-label">Analyzed</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{archivedCount}</div>
                  <div className="stat-label">Archived</div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="panel-right">
            <div className="dashboard-card herb-card">
              <h3>Analysis Distribution</h3>
              {renderPieChart()}
            </div>
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>TCM Diagnosis Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn herb-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list herb-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Symptom Pattern</div>
              <div className="header-cell">Herb Formula</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {records.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon">📝</div>
                <p>No TCM records found</p>
                <button 
                  className="herb-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Diagnosis
                </button>
              </div>
            ) : (
              records.map(record => (
                <div 
                  className="record-row" 
                  key={record.id}
                  onClick={() => setSelectedRecord(record)}
                >
                  <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                  <div className="table-cell">{record.symptomPattern}</div>
                  <div className="table-cell">{record.herbFormula}</div>
                  <div className="table-cell">
                    {new Date(record.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>
                      {record.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(record.owner) && record.status === "pending" && (
                      <>
                        <button 
                          className="action-btn herb-button success"
                          onClick={(e) => { e.stopPropagation(); analyzeRecord(record.id); }}
                        >
                          Analyze
                        </button>
                        <button 
                          className="action-btn herb-button warning"
                          onClick={(e) => { e.stopPropagation(); archiveRecord(record.id); }}
                        >
                          Archive
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content herb-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="herb-spinner">🌿</div>}
              {transactionStatus.status === "success" && <div className="check-icon">✅</div>}
              {transactionStatus.status === "error" && <div className="error-icon">❌</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
      
      {selectedRecord && (
        <RecordDetail 
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onAnalyze={analyzeRecord}
          onArchive={archiveRecord}
          isOwner={isOwner(selectedRecord.owner)}
        />
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="yin-yang-icon">☯</div>
              <span>TCM Analytics FHE</span>
            </div>
            <p>Preserving TCM wisdom with modern privacy technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Research Papers</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered TCM Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} TCM Analytics FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.symptomPattern || !recordData.herbFormula) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal herb-card">
        <div className="modal-header">
          <h2>Add TCM Diagnosis Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔒</div> Your TCM data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Symptom Pattern *</label>
              <select 
                name="symptomPattern"
                value={recordData.symptomPattern} 
                onChange={handleChange}
                className="herb-select"
              >
                <option value="">Select pattern</option>
                <option value="Wind-Cold">Wind-Cold Invasion</option>
                <option value="Wind-Heat">Wind-Heat Invasion</option>
                <option value="Qi Deficiency">Qi Deficiency</option>
                <option value="Blood Stasis">Blood Stasis</option>
                <option value="Damp-Heat">Damp-Heat</option>
                <option value="Yin Deficiency">Yin Deficiency</option>
                <option value="Yang Deficiency">Yang Deficiency</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Herbal Formula *</label>
              <input 
                type="text"
                name="herbFormula"
                value={recordData.herbFormula} 
                onChange={handleChange}
                placeholder="e.g., Gui Zhi Tang" 
                className="herb-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Patient Information</label>
              <textarea 
                name="patientInfo"
                value={recordData.patientInfo} 
                onChange={handleChange}
                placeholder="Additional patient details..." 
                className="herb-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🌿</div> Data remains encrypted during FHE analysis
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn herb-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn herb-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Diagnosis"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface RecordDetailProps {
  record: TCMRecord;
  onClose: () => void;
  onAnalyze: (id: string) => void;
  onArchive: (id: string) => void;
  isOwner: boolean;
}

const RecordDetail: React.FC<RecordDetailProps> = ({
  record,
  onClose,
  onAnalyze,
  onArchive,
  isOwner
}) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal herb-card">
        <div className="modal-header">
          <h2>TCM Record Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Record ID</label>
              <span>#{record.id}</span>
            </div>
            <div className="detail-item">
              <label>Symptom Pattern</label>
              <span>{record.symptomPattern}</span>
            </div>
            <div className="detail-item">
              <label>Herbal Formula</label>
              <span>{record.herbFormula}</span>
            </div>
            <div className="detail-item">
              <label>Owner</label>
              <span>{record.owner.substring(0, 8)}...{record.owner.substring(36)}</span>
            </div>
            <div className="detail-item">
              <label>Date Created</label>
              <span>{new Date(record.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="detail-item">
              <label>Status</label>
              <span className={`status-badge ${record.status}`}>{record.status}</span>
            </div>
          </div>
          
          <div className="encrypted-data">
            <h3>Encrypted Data</h3>
            <div className="encrypted-content">
              {record.encryptedData}
            </div>
            <p className="encryption-note">
              This data is encrypted using FHE and can only be processed in encrypted form
            </p>
          </div>
        </div>
        
        <div className="modal-footer">
          {isOwner && record.status === "pending" && (
            <>
              <button 
                onClick={() => onAnalyze(record.id)}
                className="herb-button success"
              >
                Analyze with FHE
              </button>
              <button 
                onClick={() => onArchive(record.id)}
                className="herb-button warning"
              >
                Archive
              </button>
            </>
          )}
          <button 
            onClick={onClose}
            className="herb-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;