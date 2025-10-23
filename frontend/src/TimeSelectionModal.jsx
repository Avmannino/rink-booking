import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

export default function TimeSelectionModal({ slot, onClose, onProceed }) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [validatedSlot, setValidatedSlot] = useState(null);

  const slotStart = new Date(slot.start);
  const slotEnd = new Date(slot.end);

  // Initialize with slot times
  useEffect(() => {
    const formatTime12Hour = (date) => {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, '0');
      return `${displayHours}:${displayMinutes} ${ampm}`;
    };

    // Set start time to slot start
    setStartTime(formatTime12Hour(slotStart));
    
    // Set end time to 45 minutes after start (minimum booking)
    const defaultEnd = new Date(slotStart.getTime() + 45 * 60 * 1000);
    setEndTime(formatTime12Hour(defaultEnd));
  }, [slot]);

  const validateTimeSlot = async () => {
    if (!startTime || !endTime) {
      setValidationError('Please select both start and end times');
      return;
    }

    setIsValidating(true);
    setValidationError('');

    try {
      // Parse 12-hour format times
      const parseTime12Hour = (timeStr) => {
        const [time, ampm] = timeStr.split(' ');
        const [hours, minutes] = time.split(':').map(Number);
        let hour24 = hours;
        if (ampm === 'PM' && hours !== 12) hour24 += 12;
        if (ampm === 'AM' && hours === 12) hour24 = 0;
        return { hours: hour24, minutes };
      };

      const startTimeParsed = parseTime12Hour(startTime);
      const endTimeParsed = parseTime12Hour(endTime);
      
      const customStart = new Date(slotStart);
      customStart.setHours(startTimeParsed.hours, startTimeParsed.minutes, 0, 0);
      
      const customEnd = new Date(slotStart);
      customEnd.setHours(endTimeParsed.hours, endTimeParsed.minutes, 0, 0);

      // Ensure end time is on the same day or next day
      if (customEnd <= customStart) {
        customEnd.setDate(customEnd.getDate() + 1);
      }

      const response = await axios.post(`${API_BASE}/api/validate-custom-slot`, {
        start: customStart.toISOString(),
        end: customEnd.toISOString(),
        name: 'Temporary', // Will be filled in booking modal
        email: 'temp@example.com', // Will be filled in booking modal
        purpose: 'Ice Time'
      });

      if (response.data.valid) {
        setValidatedSlot({
          ...response.data,
          start: customStart.toISOString(),
          end: customEnd.toISOString()
        });
      }
    } catch (error) {
      console.error('Validation error:', error);
      setValidationError(error.response?.data?.error || 'Failed to validate time slot');
    } finally {
      setIsValidating(false);
    }
  };

  const handleProceed = () => {
    if (validatedSlot) {
      onProceed(validatedSlot);
    }
  };

  const formatUSD = (cents) => 
    (cents / 100).toLocaleString(undefined, { 
      style: 'currency', 
      currency: 'USD', 
      minimumFractionDigits: 2 
    });

  const generateTimeOptions = (isEndTime = false) => {
    const options = [];
    
    // Convert slot times to minutes for easier calculation
    const slotStartMinutes = slotStart.getHours() * 60 + slotStart.getMinutes();
    const slotEndMinutes = slotEnd.getHours() * 60 + slotEnd.getMinutes();
    
    // For start time: latest option should be 45 minutes before slot end
    const maxStartMinutes = slotEndMinutes - 45;
    
    // Generate 15-minute intervals within the slot window
    for (let minutes = slotStartMinutes; minutes <= maxStartMinutes; minutes += 15) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      
      // Convert to 12-hour format
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = mins.toString().padStart(2, '0');
      const timeString = `${displayHours}:${displayMinutes} ${ampm}`;
      
      options.push(timeString);
    }
    
    return options;
  };

  const generateEndTimeOptions = () => {
    const options = [];
    
    // Parse current start time to get constraints
    const parseTime12Hour = (timeStr) => {
      const [time, ampm] = timeStr.split(' ');
      const [hours, minutes] = time.split(':').map(Number);
      let hour24 = hours;
      if (ampm === 'PM' && hours !== 12) hour24 += 12;
      if (ampm === 'AM' && hours === 12) hour24 = 0;
      return { hours: hour24, minutes };
    };

    const startTimeParsed = parseTime12Hour(startTime);
    const slotStartMinutes = slotStart.getHours() * 60 + slotStart.getMinutes();
    const slotEndMinutes = slotEnd.getHours() * 60 + slotEnd.getMinutes();
    const startMinutes = startTimeParsed.hours * 60 + startTimeParsed.minutes;
    
    // End time must be at least 45 minutes after start, and within slot window
    const minEndMinutes = Math.max(startMinutes + 45, slotStartMinutes);
    const maxEndMinutes = slotEndMinutes;
    
    for (let minutes = minEndMinutes; minutes <= maxEndMinutes; minutes += 15) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      
      // Convert to 12-hour format
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = mins.toString().padStart(2, '0');
      const timeString = `${displayHours}:${displayMinutes} ${ampm}`;
      
      options.push(timeString);
    }
    
    return options;
  };

  const startTimeOptions = generateTimeOptions(false);
  const endTimeOptions = generateEndTimeOptions();

  // Update end time options when start time changes
  useEffect(() => {
    const newEndOptions = generateEndTimeOptions();
    // If current end time is not in the new options, reset to first valid option
    if (!newEndOptions.includes(endTime)) {
      setEndTime(newEndOptions[0] || endTime);
    }
  }, [startTime]);

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h2 style={{ marginTop: 0, color: '#E6E8F0' }}>
          Select Your Ice Time
        </h2>

        <div style={styles.slotInfo}>
          <p style={{ margin: '0 0 8px 0', color: '#CBD5E1' }}>
            <strong>Available Window:</strong> {slotStart.toLocaleDateString()} from {slotStart.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to {slotEnd.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
          <p style={{ margin: '0 0 16px 0', color: '#CBD5E1', fontSize: '14px' }}>
            Choose your preferred start and end times within this window. Minimum booking is 45 minutes.
          </p>
        </div>

        <div style={styles.timeSelection}>
          <div style={styles.timeGroup}>
            <label style={styles.label}>
              Start Time
              <select 
                value={startTime} 
                onChange={(e) => setStartTime(e.target.value)}
                style={styles.timeSelect}
              >
                {startTimeOptions.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={styles.timeGroup}>
            <label style={styles.label}>
              End Time
              <select 
                value={endTime} 
                onChange={(e) => setEndTime(e.target.value)}
                style={styles.timeSelect}
              >
                {endTimeOptions.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {validationError && (
          <div style={styles.errorMessage}>
            {validationError}
          </div>
        )}

        {validatedSlot && (
          <div style={styles.validationSuccess}>
            <div style={styles.priceInfo}>
              <strong>Duration:</strong> {validatedSlot.duration_minutes} minutes
            </div>
            <div style={styles.priceInfo}>
              <strong>Price:</strong> {formatUSD(validatedSlot.price_cents)}
            </div>
          </div>
        )}

        <div style={styles.buttonGroup}>
          <button 
            type="button" 
            onClick={onClose} 
            style={styles.secondaryBtn}
          >
            Cancel
          </button>
          
          <button 
            type="button" 
            onClick={validateTimeSlot}
            disabled={isValidating}
            style={styles.confirmBtn}
          >
            {isValidating ? 'Confirming...' : 'Confirm Times'}
          </button>

          {validatedSlot && (
            <button 
              type="button" 
              onClick={handleProceed}
              style={styles.primaryBtn}
            >
              Proceed to Booking
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: { 
    position: 'fixed', 
    inset: 0, 
    background: 'rgba(0,0,0,0.5)', 
    display: 'grid', 
    placeItems: 'center', 
    padding: 16, 
    zIndex: 9999 
  },
  modal: { 
    width: '100%', 
    maxWidth: 520, 
    background: '#0f172a', 
    border: '1px solid #1f2a44', 
    borderRadius: 12, 
    padding: 20, 
    boxShadow: '0 16px 32px rgba(0,0,0,0.45)' 
  },
  slotInfo: {
    background: '#1e293b',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16
  },
  timeSelection: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginBottom: 16
  },
  timeGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  label: { 
    display: 'grid', 
    gap: 6, 
    fontSize: 14, 
    color: '#E5E7EB' 
  },
  timeSelect: { 
    width: '100%', 
    padding: '10px 12px', 
    borderRadius: 10, 
    border: '1px solid #334155', 
    outline: 'none', 
    background: '#0b1220', 
    color: '#E5E7EB',
    fontSize: 16
  },
  errorMessage: {
    background: '#7f1d1d',
    border: '1px solid #dc2626',
    borderRadius: 8,
    padding: 12,
    color: '#fca5a5',
    marginBottom: 16,
    fontSize: 14
  },
  validationSuccess: {
    background: '#064e3b',
    border: '1px solid #059669',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    color: '#6ee7b7'
  },
  priceInfo: {
    marginBottom: 4,
    fontSize: 14
  },
  buttonGroup: { 
    display: 'flex', 
    gap: 8, 
    justifyContent: 'flex-end', 
    marginTop: 4,
    flexWrap: 'wrap'
  },
  secondaryBtn: { 
    appearance: 'none', 
    border: 'none', 
    borderRadius: 9999, 
    padding: '10px 16px', 
    fontWeight: 600, 
    cursor: 'pointer', 
    background: '#e5e7eb', 
    color: '#111827' 
  },
  confirmBtn: { 
    appearance: 'none', 
    border: 'none', 
    borderRadius: 9999, 
    padding: '10px 16px', 
    fontWeight: 600, 
    cursor: 'pointer', 
    background: '#10b981', 
    color: '#fff' 
  },
  primaryBtn: { 
    appearance: 'none', 
    border: 'none', 
    borderRadius: 9999, 
    padding: '10px 16px', 
    fontWeight: 600, 
    cursor: 'pointer', 
    background: '#4f46e5', 
    color: '#fff' 
  }
};
