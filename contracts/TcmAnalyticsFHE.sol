// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TcmAnalyticsFHE is SepoliaConfig {
    struct EncryptedRecord {
        uint256 id;
        euint32 encryptedSymptom;
        euint32 encryptedPrescription;
        euint32 encryptedClinicId;
        uint256 timestamp;
    }
    
    struct DecryptedRecord {
        string symptom;
        string prescription;
        string clinicId;
        bool isAnalyzed;
    }

    uint256 public recordCount;
    mapping(uint256 => EncryptedRecord) public encryptedRecords;
    mapping(uint256 => DecryptedRecord) public decryptedRecords;
    
    mapping(string => euint32) private encryptedPrescriptionCount;
    string[] private prescriptionList;
    
    mapping(uint256 => uint256) private requestToRecordId;
    
    event RecordSubmitted(uint256 indexed id, uint256 timestamp);
    event AnalysisRequested(uint256 indexed id);
    event RecordAnalyzed(uint256 indexed id);
    
    modifier onlyClinic(uint256 recordId) {
        _;
    }
    
    function submitEncryptedRecord(
        euint32 encryptedSymptom,
        euint32 encryptedPrescription,
        euint32 encryptedClinicId
    ) public {
        recordCount += 1;
        uint256 newId = recordCount;
        
        encryptedRecords[newId] = EncryptedRecord({
            id: newId,
            encryptedSymptom: encryptedSymptom,
            encryptedPrescription: encryptedPrescription,
            encryptedClinicId: encryptedClinicId,
            timestamp: block.timestamp
        });
        
        decryptedRecords[newId] = DecryptedRecord({
            symptom: "",
            prescription: "",
            clinicId: "",
            isAnalyzed: false
        });
        
        emit RecordSubmitted(newId, block.timestamp);
    }
    
    function requestRecordAnalysis(uint256 recordId) public onlyClinic(recordId) {
        EncryptedRecord storage record = encryptedRecords[recordId];
        require(!decryptedRecords[recordId].isAnalyzed, "Already analyzed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(record.encryptedSymptom);
        ciphertexts[1] = FHE.toBytes32(record.encryptedPrescription);
        ciphertexts[2] = FHE.toBytes32(record.encryptedClinicId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.analyzeRecord.selector);
        requestToRecordId[reqId] = recordId;
        
        emit AnalysisRequested(recordId);
    }
    
    function analyzeRecord(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 recordId = requestToRecordId[requestId];
        require(recordId != 0, "Invalid request");
        
        EncryptedRecord storage eRecord = encryptedRecords[recordId];
        DecryptedRecord storage dRecord = decryptedRecords[recordId];
        require(!dRecord.isAnalyzed, "Already analyzed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory symptom, string memory prescription, string memory clinicId) = 
            abi.decode(cleartexts, (string, string, string));
        
        dRecord.symptom = symptom;
        dRecord.prescription = prescription;
        dRecord.clinicId = clinicId;
        dRecord.isAnalyzed = true;
        
        if (FHE.isInitialized(encryptedPrescriptionCount[dRecord.prescription]) == false) {
            encryptedPrescriptionCount[dRecord.prescription] = FHE.asEuint32(0);
            prescriptionList.push(dRecord.prescription);
        }
        encryptedPrescriptionCount[dRecord.prescription] = FHE.add(
            encryptedPrescriptionCount[dRecord.prescription], 
            FHE.asEuint32(1)
        );
        
        emit RecordAnalyzed(recordId);
    }
    
    function getDecryptedRecord(uint256 recordId) public view returns (
        string memory symptom,
        string memory prescription,
        string memory clinicId,
        bool isAnalyzed
    ) {
        DecryptedRecord storage r = decryptedRecords[recordId];
        return (r.symptom, r.prescription, r.clinicId, r.isAnalyzed);
    }
    
    function getEncryptedPrescriptionCount(string memory prescription) public view returns (euint32) {
        return encryptedPrescriptionCount[prescription];
    }
    
    function requestPrescriptionCountDecryption(string memory prescription) public {
        euint32 count = encryptedPrescriptionCount[prescription];
        require(FHE.isInitialized(count), "Prescription not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPrescriptionCount.selector);
        requestToRecordId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(prescription)));
    }
    
    function decryptPrescriptionCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 prescriptionHash = requestToRecordId[requestId];
        string memory prescription = getPrescriptionFromHash(prescriptionHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getPrescriptionFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < prescriptionList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(prescriptionList[i]))) == hash) {
                return prescriptionList[i];
            }
        }
        revert("Prescription not found");
    }
    
    function findPatternCorrelation(
        string memory targetSymptom,
        string memory targetPrescription
    ) public view returns (uint256 correlationCount) {
        for (uint256 i = 1; i <= recordCount; i++) {
            if (decryptedRecords[i].isAnalyzed && 
                keccak256(abi.encodePacked(decryptedRecords[i].symptom)) == keccak256(abi.encodePacked(targetSymptom)) &&
                keccak256(abi.encodePacked(decryptedRecords[i].prescription)) == keccak256(abi.encodePacked(targetPrescription))) {
                correlationCount++;
            }
        }
        return correlationCount;
    }
}