import './Navbar.css';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

const Navbar = () => {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [menuOpen, setMenuOpen] = useState(false); // for toggle button

  useEffect(() => {
    const email = localStorage.getItem('userEmail');
    if (email) {
      setIsLoggedIn(true);
      setUserEmail(email);
    } else {
      setIsLoggedIn(false);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('userEmail');
    setIsLoggedIn(false);
    navigate('/login');
  };

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  return (
    <nav className="navbar navbar-expand-lg">
      <div className="container-fluid" id="navbar">
        <div>
          <h1>Stock LLM</h1>
        </div>

        {/* Toggle button for small screens */}
        <button
          className="navbar-toggler"
          type="button"
          onClick={toggleMenu}
          aria-controls="navbarNav"
          aria-expanded={menuOpen}
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon">☰</span>
        </button>

        {/* Menu items, show/hide based on menuOpen */}
        <div
          className={`collapse navbar-collapse ${menuOpen ? 'show' : ''}`}
          id="navbarNav"
        >
          <ul className="navbar-nav ms-auto">
            {!isLoggedIn && (
              <>
                <li className="nav-item">
                  <Link className="nav-link active button" to="/login" onClick={() => setMenuOpen(false)}>
                    Login
                  </Link>
                </li>
                <li className="nav-item">
                  <Link className="nav-link active button" to="/signup" onClick={() => setMenuOpen(false)}>
                    Signup
                  </Link>
                </li>
              </>
            )}

         {isLoggedIn && (
  <>
    <li className="nav-item">
      <Link
        className="nav-link active button"
        to="/dashboard"
        onClick={() => setMenuOpen(false)}
      >
        Dashboard
      </Link>
    </li>
    <li className="nav-item">
      <Link
        className="nav-link active button"
        to="/detailsTable"
        onClick={() => setMenuOpen(false)}
      >
        Stocks
      </Link>
    </li>
    <li className="nav-item">
      <Link
        className="nav-link active button"
        onClick={() => {
          handleLogout();
          setMenuOpen(false);
        }}
      >
        Logout
      </Link>
    </li>
  </>
)}


          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
