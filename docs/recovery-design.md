# Intelligent Print Recovery Engine Design

## 1. Problem Statement & Real-World Hardware Failure Modes

When printing to an entry-level printer like the **HP Smart Tank 580**:
1. **Network Spooling Illusion**:
   - The device has a 64 MB onboard buffer.
   - A 10-page document is completely transmitted from the phone across Wi-Fi Direct in ~3 seconds.
   - Standard printing libraries report `print-job finished` as soon as the last network packet is sent.
2. **Physical Interruption**:
   - The printer starts physically feeding paper.
   - At Page 4, paper jams, ink runs dry, or the user walks out of Wi-Fi Direct range.
   - The printer's internal volatile RAM buffer drops.
3. **The Naive Recovery Pitfall**:
   - Standard print tools blindly restart the entire job (reprinting Pages 1–3, wasting ink, sheets, and time), or fail completely with no resume capability.

---

## 2. PaperPilot Checkpoint Architecture

PaperPilot implements a **Granular Checkpoint & Confirmation Protocol**:

```
+-------------------------------------------------------------+
|                     Original Print Job                      |
| Document: 20 Pages | Copies: 3                              |
+-------------------------------------------------------------+
                                |
                                v
           +----------------------------------------+
           | Copy 1 (Pages 1 to 20):  COMPLETED     |
           | Checkpoint committed in SQLite         |
           +----------------------------------------+
                                |
                                v
           +----------------------------------------+
           | Copy 2 (Pages 1 to 4):   CONFIRMED     |
           | Interrupt at Page 5 (Paper / WFD Drop) |
           +----------------------------------------+
                                |
                                v
                +-------------------------------+
                | State: NEEDS_CONFIRMATION     |
                | User Notification Dispatched  |
                +-------------------------------+
                                |
               User Confirms: "Page 4 printed OK"
                                |
                                v
           +----------------------------------------+
           | Synthetic Resume Slice:                |
           | Copy 2: Pages 5 to 20                  |
           | Copy 3: Pages 1 to 20 (Remaining)      |
           +----------------------------------------+
```

---

## 3. Database Checkpoint Model

Every sheet verified via printer IPP status (`job-impressions-completed`) or confirmed by the user is recorded in `print_job_checkpoints`:

- `job_id`: Reference to parent job.
- `copy_index`: Which copy iteration is active.
- `completed_page`: Last physical page verified.
- `is_verified_by_sensor`: Flag indicating if printer hardware sensor confirmed paper exit.
- `user_confirmed`: Flag indicating if human confirmed physical visual inspection.

---

## 4. State Transitions on Interruption

```
[PRINTING] 
     |
  (Network drop / Printer Error)
     v
[INTERRUPTED]
     |
  (Can we verify exact sheet via IPP sensor query on reconnect?)
     |
     +---> YES ---> [PENDING] (Resume slice auto-dispatched)
     |
     +---> NO / AMBIGUOUS ---> [NEEDS_CONFIRMATION]
                                      |
                              (User confirms page)
                                      v
                                  [PENDING] (Resume slice committed)
```

By decoupling network socket delivery from confirmed physical paper exit, PaperPilot guarantees no double-printing and zero wasted paper.
